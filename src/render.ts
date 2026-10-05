// Score + avatar → video. The mesh engine runs in headless Chrome, advanced one frame at a
// time; frames are piped to ffmpeg together with the audio.
import puppeteer from "puppeteer";
import { readAudio } from "./audio-file.ts";
import { frameLevels } from "./audio.ts";
import type { Avatar } from "./avatar.ts";
import { loadEngine } from "./engine.ts";
import { outputCodecs, startEncoder } from "./render-encoder.ts";
import { openAvatarPage, renderBatch, type FramePlan } from "./render-page.ts";
import { installSubtitles, pageSubtitles } from "./render-subtitles.ts";
import type { Score } from "./score.ts";
import { captionAt, resolveSubtitles, type SubtitleStyleInput } from "./subtitles.ts";
import { resolveView, type ViewInput } from "./view.ts";
import { MESH_MOUTH, visemeAt } from "./visemes.ts";

export interface RenderOptions {
  avatar: Avatar;
  score: Score;
  /** the score's speech (any format ffmpeg reads); it moves the head with the voice */
  audioPath: string;
  /** mux the speech into the video (default true); false writes the picture only */
  audio?: boolean;
  out: string;
  fps?: number;
  width?: number;
  height?: number;
  /** background and avatar placement over the score's */
  view?: ViewInput;
  /** mesh-avatar-studio checkout to bundle the engine from, instead of the bundled copy */
  engineRoot?: string;
  seed?: number;
  /** mouth shapes lead the sound slightly so the smoothed mouth arrives on time, seconds */
  mouthLead?: number;
  /** subtitles over the score's: false off, true on, or style fields to change */
  subtitles?: boolean | SubtitleStyleInput;
  onProgress?: (frame: number, total: number) => void;
}

/** What the engine should do on each frame. */
export function planFrames(score: Score, levels: Float32Array, fps: number, mouthLead: number, captions = false): FramePlan[] {
  const plans: FramePlan[] = [];
  let cue = 0;
  for (let f = 0; f < levels.length; f++) {
    const t = f / fps;
    const speaking = score.speaking.some(([a, b]) => t >= a && t < b);
    const viseme = visemeAt(score.visemes, t + mouthLead);
    const actions: FramePlan["actions"] = [];
    while (cue < score.cues.length && score.cues[cue].t < t + 0.5 / fps) {
      const c = score.cues[cue++];
      if ("emotion" in c) actions.push(["emotion", c.emotion]);
      else if ("motion" in c) actions.push(["motion", c.motion]);
    }
    const caption = captions ? (captionAt(score.captions, t)?.text ?? null) : null;
    plans.push({ mouth: speaking || viseme !== "sil" ? MESH_MOUTH[viseme] : null, speaking, level: speaking ? levels[f] : 0, actions, caption });
  }
  return plans;
}

export async function render(options: RenderOptions): Promise<void> {
  const { avatar, score, out, fps = 30, width = 1280, height = 720, seed = 1, mouthLead = 0.04 } = options;
  const unsupported = score.cues.filter((c) => "gaze" in c || "emphasis" in c);
  if (unsupported.length) console.warn(`note: ${unsupported.length} gaze/emphasis cue(s) are not rendered yet by the mesh runtime`);
  const audio = await readAudio(options.audioPath);
  const subtitles = resolveSubtitles(score.subtitles, options.subtitles);
  const plans = planFrames(score, frameLevels(audio, fps, Math.ceil(score.duration * fps)), fps, mouthLead, subtitles !== null);
  const view = resolveView(score.view, options.view);
  const engine = await loadEngine(options.engineRoot);
  outputCodecs(out, false, options.audio !== false); // an unusable extension fails before the browser starts

  const browser = await puppeteer.launch({ headless: true });
  let encoder: ReturnType<typeof startEncoder> | undefined;
  try {
    const { page, motions, errors, opaque } = await openAvatarPage(browser, { avatar, engine, width, height, view, seed });
    encoder = startEncoder(out, options.audio === false ? null : options.audioPath, fps, !opaque);
    const unknown = [...new Set(score.cues.flatMap((c) => ("motion" in c && !motions.includes(c.motion) ? [c.motion] : [])))];
    if (unknown.length) throw new Error(`unknown motion(s) for this avatar: ${unknown.join(", ")}. Available: ${motions.join(", ")}`);
    if (subtitles) await installSubtitles(page, await pageSubtitles(subtitles, width, height));
    const BATCH = 30;
    for (let f = 0; f < plans.length; f += BATCH) {
      const images = await renderBatch(page, plans.slice(f, f + BATCH), fps);
      if (errors.length) throw new Error(`avatar page error: ${errors.join("\n")}`);
      for (const img of images) await encoder.write(Buffer.from(img, "base64"));
      options.onProgress?.(Math.min(plans.length, f + BATCH), plans.length);
    }
    await encoder.finish();
  } catch (error) {
    encoder?.abort();
    throw error;
  } finally {
    await browser.close();
  }
}
