// Score + avatar → video. The mesh engine runs in headless Chrome, advanced one frame at a
// time; frames are piped to ffmpeg together with the audio.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { fromWav, frameLevels } from "./audio.ts";
import type { Avatar } from "./avatar.ts";
import { loadEngine } from "./engine.ts";
import type { Score } from "./score.ts";
import { MESH_MOUTH, visemeAt, type MeshMouth } from "./visemes.ts";

export interface RenderOptions {
  avatar: Avatar;
  score: Score;
  /** audio file the score refers to */
  audioPath: string;
  out: string;
  fps?: number;
  width?: number;
  height?: number;
  background?: string;
  /** mesh-avatar-studio checkout to bundle the engine from, instead of the bundled copy */
  engineRoot?: string;
  seed?: number;
  /** mouth shapes lead the sound slightly so the smoothed mouth arrives on time, seconds */
  mouthLead?: number;
  onProgress?: (frame: number, total: number) => void;
}

/** One video frame's input to the engine. */
interface FramePlan {
  mouth: MeshMouth | null;
  speaking: boolean;
  level: number;
  actions: (["emotion", string] | ["motion", string])[];
}

/** The part of the mesh engine's avatar API the renderer drives (mesh-avatar-studio src/engine/index.ts). */
interface MeshAvatarApi {
  readonly motions: { id: string }[];
  setEmotion(tag: string, options: { playMotion: boolean }): void;
  play(id: string): void;
  setSpeaking(on: boolean): void;
  setVoiceLevel(level: number): void;
  holdMouth(vowel: MeshMouth): void;
  stopLipSync(): void;
  setAutoMotion(on: boolean): void;
  setAutoIdle(on: boolean): void;
  advance(seconds: number, fps: number): void;
}

/** What the render page keeps between batches. */
interface PageState {
  av: MeshAvatarApi;
  canvas: HTMLCanvasElement;
  outCanvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  background: string;
  /** a mouth shape is being held */
  lip: boolean;
}

declare global {
  interface Window {
    /** set by the bundled engine script */
    MeshAvatarEngine?: {
      createMeshAvatar(canvas: HTMLCanvasElement, options: { rig: unknown; assets: Record<string, string>; manual: boolean }): Promise<MeshAvatarApi>;
    };
    avatarscript?: PageState;
  }
}

/** What the engine should do on each frame. */
export function planFrames(score: Score, levels: Float32Array, fps: number, mouthLead: number): FramePlan[] {
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
    plans.push({ mouth: speaking || viseme !== "sil" ? MESH_MOUTH[viseme] : null, speaking, level: speaking ? levels[f] : 0, actions });
  }
  return plans;
}

interface Encoder {
  write(jpeg: Buffer): Promise<void>;
  finish(): Promise<void>;
  abort(): void;
}

/** ffmpeg reading JPEG frames on stdin and muxing them with the audio into an MP4. */
function startEncoder(out: string, audioPath: string, fps: number): Encoder {
  const args = ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-", "-i", audioPath];
  const output = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out];
  const ffmpeg = spawn("ffmpeg", [...args, ...output], { stdio: ["pipe", "inherit", "pipe"] });
  let stderr = "";
  ffmpeg.stderr.on("data", (d: Buffer) => {
    stderr += d.toString();
  });
  const done = new Promise<void>((res, rej) => {
    ffmpeg.on("error", rej);
    ffmpeg.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg failed (${code}): ${stderr.trim()}`))));
  });
  done.catch(() => undefined); // reported where it is awaited
  return {
    async write(jpeg) {
      if (!ffmpeg.stdin.write(jpeg)) await new Promise((r) => ffmpeg.stdin.once("drain", r));
    },
    finish() {
      ffmpeg.stdin.end();
      return done;
    },
    abort() {
      ffmpeg.stdin.destroy();
      ffmpeg.kill();
    },
  };
}

interface PageOptions {
  avatar: Avatar;
  engine: string;
  width: number;
  height: number;
  background: string;
  seed: number;
}

/** A page with the engine and the avatar loaded and settled; returns the avatar's motions. */
async function openAvatarPage(browser: Browser, o: PageOptions): Promise<{ page: Page; motions: string[]; errors: string[] }> {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e instanceof Error ? e.message : String(e)));
  // nothing leaves the machine: the page gets the engine and the avatar inline
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    (/^(data|about|blob):/.test(r.url()) ? r.continue() : r.abort()).catch(() => undefined);
  });
  await page.setViewport({ width: o.width, height: o.height, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;overflow:hidden"><canvas id="avatar" style="display:block;width:${o.width}px;height:${o.height}px"></canvas></body></html>`,
  );
  await page.evaluate((s: number) => {
    // seeded Math.random (mulberry32): blinks, glances and idle motions repeat exactly
    let a = s >>> 0;
    Math.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }, o.seed);
  await page.addScriptTag({ content: o.engine });
  const motions = await page.evaluate(
    async (rig: unknown, assets: Record<string, string>, width: number, height: number, background: string) => {
      const canvas = document.getElementById("avatar");
      const outCanvas = document.createElement("canvas");
      const ctx = outCanvas.getContext("2d");
      const engine = window.MeshAvatarEngine;
      if (!(canvas instanceof HTMLCanvasElement) || !ctx || !engine) throw new Error("render page did not load");
      const av = await engine.createMeshAvatar(canvas, { rig, assets, manual: true });
      av.setAutoMotion(false);
      av.setAutoIdle(true);
      av.setEmotion("neutral", { playMotion: false });
      av.advance(1.5, 60); // let springs and hair settle before the first frame
      outCanvas.width = width;
      outCanvas.height = height;
      window.avatarscript = { av, canvas, outCanvas, ctx, background, lip: false };
      return av.motions.map((m) => m.id);
    },
    o.avatar.rig,
    o.avatar.assets,
    o.width,
    o.height,
    o.background,
  );
  return { page, motions, errors };
}

/** Drives the engine through a batch of frames; returns them as base64 JPEGs. */
function renderBatch(page: Page, batch: FramePlan[], fps: number): Promise<string[]> {
  return page.evaluate(
    (frames: FramePlan[], fps: number) => {
      const s = window.avatarscript;
      if (!s) throw new Error("render page is not set up");
      return frames.map((p) => {
        for (const [kind, value] of p.actions) {
          if (kind === "emotion") s.av.setEmotion(value, { playMotion: false });
          else s.av.play(value);
        }
        s.av.setSpeaking(p.speaking);
        s.av.setVoiceLevel(p.level);
        if (p.mouth) s.av.holdMouth(p.mouth);
        else if (s.lip) s.av.stopLipSync(); // silence: the expression's own mouth
        s.lip = p.mouth !== null;
        s.av.advance(1 / fps, fps * 2);
        s.ctx.fillStyle = s.background;
        s.ctx.fillRect(0, 0, s.outCanvas.width, s.outCanvas.height);
        s.ctx.drawImage(s.canvas, 0, 0, s.outCanvas.width, s.outCanvas.height);
        return s.outCanvas.toDataURL("image/jpeg", 0.92).split(",")[1];
      });
    },
    batch,
    fps,
  );
}

export async function render(options: RenderOptions): Promise<void> {
  const { avatar, score, out, fps = 30, width = 1280, height = 720, background = "#e9edf2", seed = 1, mouthLead = 0.04 } = options;
  const unsupported = score.cues.filter((c) => "gaze" in c || "emphasis" in c);
  if (unsupported.length) console.warn(`note: ${unsupported.length} gaze/emphasis cue(s) are not rendered yet by the mesh runtime`);
  const audio = fromWav(await readFile(options.audioPath));
  const plans = planFrames(score, frameLevels(audio, fps, Math.ceil(score.duration * fps)), fps, mouthLead);
  const engine = await loadEngine(options.engineRoot);

  const browser = await puppeteer.launch({ headless: true });
  const encoder = startEncoder(out, options.audioPath, fps);
  try {
    const { page, motions, errors } = await openAvatarPage(browser, { avatar, engine, width, height, background, seed });
    const unknown = [...new Set(score.cues.flatMap((c) => ("motion" in c && !motions.includes(c.motion) ? [c.motion] : [])))];
    if (unknown.length) throw new Error(`unknown motion(s) for this avatar: ${unknown.join(", ")}. Available: ${motions.join(", ")}`);
    const BATCH = 30;
    for (let f = 0; f < plans.length; f += BATCH) {
      const images = await renderBatch(page, plans.slice(f, f + BATCH), fps);
      if (errors.length) throw new Error(`avatar page error: ${errors.join("\n")}`);
      for (const img of images) await encoder.write(Buffer.from(img, "base64"));
      options.onProgress?.(Math.min(plans.length, f + BATCH), plans.length);
    }
    await encoder.finish();
  } catch (error) {
    encoder.abort();
    throw error;
  } finally {
    await browser.close();
  }
}
