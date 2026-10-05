// Script + TTS → audio and a timed score.
import { concat, silence, type Pcm } from "./audio.ts";
import { textVisemes, type CharTime } from "./g2p/index.ts";
import type { Score, ScoreCue } from "./score.ts";
import type { Cue, Script } from "./script.ts";
import { joinCaptions, resolveSubtitles, segmentCaptions, subtitlesFromFrontMatter, type Caption, type SubtitleStyleInput } from "./subtitles.ts";
import { isSpoken } from "./timing.ts";
import { resolveView, viewFromFrontMatter, type ViewInput } from "./view.ts";
import type { TextToSpeech } from "./tts/types.ts";
import { normalizeEvents, type VisemeEvent } from "./visemes.ts";

export interface CompileOptions {
  lang: string;
  /** silence before the first line and after the last, seconds */
  leadIn?: number;
  tail?: number;
  /** silence between segments that have no explicit pause */
  gap?: number;
  /** recorded in the score */
  scriptName?: string;
  audioName?: string;
  /** subtitles over the script's front matter: false off, true on, or style fields to change */
  subtitles?: boolean | SubtitleStyleInput;
  /** background and avatar placement over the script's front matter */
  view?: ViewInput;
  /** folder that file paths in the front matter (a background image) are relative to; default: the working directory */
  baseDir?: string;
  onSegment?: (index: number, total: number, text: string) => void;
}

/** Guess the language from the text: Japanese if it has kana or kanji, otherwise English. */
export const detectLang = (text: string) => (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text) ? "ja" : "en");

const ms = (t: number) => Math.round(t * 1000) / 1000;

/** The spoken audio laid out on one timeline, segment by segment. */
interface Timeline {
  sampleRate: number;
  parts: Float32Array[];
  /** end of the audio so far, seconds */
  t: number;
  visemes: VisemeEvent[];
  /** one span per segment */
  speaking: [number, number][];
  cues: ScoreCue[];
  captions: Caption[];
  /** time of each spoken character, by offset in the plain text */
  charTimes: Map<number, CharTime>;
}

function pushSilence(tl: Timeline, seconds: number) {
  if (seconds <= 0) return;
  const samples = silence(seconds, tl.sampleRate);
  tl.parts.push(samples);
  tl.t += samples.length / tl.sampleRate;
}

async function layOut(script: Script, tts: TextToSpeech, options: CompileOptions): Promise<Timeline> {
  const { lang, leadIn = 0.4, tail = 0.8, gap = 0.1 } = options;
  const tl: Timeline = { sampleRate: 0, parts: [], t: 0, visemes: [], speaking: [], cues: [], captions: [], charTimes: new Map() };
  for (const [i, seg] of script.segments.entries()) {
    options.onSegment?.(i, script.segments.length, seg.text);
    const syn = await tts.synthesize({
      text: seg.text,
      lang,
      emotion: seg.emotion,
      previousText: script.segments[i - 1]?.text,
      nextText: script.segments[i + 1]?.text,
    });
    if (!tl.sampleRate) tl.sampleRate = syn.sampleRate;
    if (syn.sampleRate !== tl.sampleRate) throw new Error("segments came back at different sample rates");
    pushSilence(tl, i === 0 ? leadIn + seg.pauseBefore : seg.pauseBefore || gap);
    const start = tl.t;
    // the face changes slightly before the voice does
    tl.cues.push({ t: ms(Math.max(0, start - 0.15)), emotion: seg.emotion });
    const chars = Array.from(seg.text);
    // the engine returns final timing (corrected or aligned), whatever the provider
    const times = syn.timing.map((c) => ({ start: start + c.start, end: start + c.end }));
    times.forEach((time, k) => tl.charTimes.set(seg.offset + k, time));
    tl.visemes.push(...(await textVisemes(chars, times)));
    tl.captions.push(...segmentCaptions(seg.text, times));
    const spoken = times.filter((_, k) => isSpoken(chars[k]));
    tl.speaking.push([spoken.at(0)?.start ?? start, spoken.at(-1)?.end ?? start]);
    tl.parts.push(syn.samples);
    tl.t += syn.samples.length / tl.sampleRate;
  }
  pushSilence(tl, script.pauseAfter + tail);
  return tl;
}

function scoreCue(cue: Cue, t: number): ScoreCue {
  if ("motion" in cue) return { t, motion: cue.motion };
  if ("gaze" in cue) return { t, gaze: cue.gaze };
  return { t, emphasis: true };
}

/**
 * When each script cue fires: with the next spoken character of the segment it was written in, or
 * when that segment's speech ends if none follows ("…です！<surprise>"). A cue written after the
 * last speech fires when the speech ends.
 */
function resolveCues(script: Script, tl: Timeline): ScoreCue[] {
  const plain = Array.from(script.plain);
  const startOf = (offset: number) => {
    const time = tl.charTimes.get(offset);
    if (!time) throw new Error(`no timing for character ${offset}`);
    return time.start;
  };
  const timeAt = (cue: Cue): number => {
    if (cue.segment >= script.segments.length) return tl.speaking.at(-1)?.[1] ?? 0;
    const seg = script.segments[cue.segment];
    const last = seg.offset + Array.from(seg.text).length - 1;
    for (let o = Math.max(cue.offset, seg.offset); o <= last; o++) if (isSpoken(plain[o])) return startOf(o);
    return tl.speaking[cue.segment][1];
  };
  return script.cues.map((cue) => scoreCue(cue, ms(timeAt(cue))));
}

export async function compile(script: Script, tts: TextToSpeech, options: CompileOptions): Promise<{ score: Score; audio: Pcm }> {
  if (!script.segments.length) throw new Error("the script has nothing to say");
  const subtitles = resolveSubtitles(subtitlesFromFrontMatter(script.meta), options.subtitles);
  const view = resolveView(viewFromFrontMatter(script.meta, options.baseDir ?? process.cwd()), options.view);
  const tl = await layOut(script, tts, options);
  const cues = [...tl.cues, ...resolveCues(script, tl)].sort((a, b) => a.t - b.t);
  const score: Score = {
    format: "avatarscript-score/1",
    lang: options.lang,
    audio: options.audioName ?? "audio.wav",
    duration: ms(tl.t),
    visemes: normalizeEvents(tl.visemes),
    speaking: tl.speaking.map(([a, b]) => [ms(a), ms(b)]),
    cues,
    captions: joinCaptions(tl.captions).map((c) => ({ start: ms(c.start), end: ms(c.end), text: c.text })),
    subtitles,
    view,
    provenance: { tts: { provider: tts.provider, model: tts.model, voice: tts.voice }, ...(options.scriptName ? { script: options.scriptName } : {}) },
  };
  return { score, audio: { samples: concat(tl.parts), sampleRate: tl.sampleRate } };
}
