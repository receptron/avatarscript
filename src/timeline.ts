// A score from speech that already exists: audio files placed on a timeline, each with the text
// it says. This is how a host that does its own text-to-speech (MulmoCast) drives an avatar: no
// TTS is called, and character timing comes from forced alignment of the text to the audio.
import { readAudio } from "./audio-file.ts";
import type { Pcm } from "./audio.ts";
import { textVisemes, type CharTime } from "./g2p/index.ts";
import type { Score, ScoreCue } from "./score.ts";
import type { Emotion } from "./script.ts";
import { joinCaptions, segmentCaptions, type Caption } from "./subtitles.ts";
import { isSpoken, trimToVoice } from "./timing.ts";
import { resolveView, type ViewInput } from "./view.ts";
import { normalizeEvents, type VisemeEvent } from "./visemes.ts";

/** A motion during a segment: at its start, or where the words `at` are spoken. */
export interface TimelineMotion {
  motion: string;
  at?: string;
}

export interface TimelineSegment {
  /** what the audio says */
  text: string;
  /** an audio file ffmpeg can read (mp3, wav, …) */
  audio: string;
  /** where the audio starts on the timeline, seconds */
  start: number;
  emotion?: Emotion;
  motions?: TimelineMotion[];
}

export interface TimelineOptions {
  lang: string;
  /** length of the timeline, seconds; default: the end of the last segment plus half a second */
  duration?: number;
  /** character timing of a segment's audio; default: forced alignment (needs onnxruntime-node) */
  timing?: (text: string, audio: Pcm) => Promise<CharTime[]>;
  /** recorded in the score as its audio file */
  audioName?: string;
  /** background and avatar placement */
  view?: ViewInput;
}

const RATE = 24000;
const ms = (t: number) => Math.round(t * 1000) / 1000;

async function alignedTiming(text: string, audio: Pcm): Promise<CharTime[]> {
  const { alignText } = await import("./align/index.ts");
  const { timing } = await alignText(text, audio.samples, audio.sampleRate);
  return trimToVoice(Array.from(text), timing, audio.samples, audio.sampleRate);
}

/** Code-point index of `words` in `chars` at or after `from`, or -1. */
function indexOfWords(chars: string[], words: string, from: number): number {
  const text = chars.join("");
  const start = Array.from(text).slice(0, from).join("").length;
  const at = text.indexOf(words, start);
  return at < 0 ? -1 : Array.from(text.slice(0, at)).length;
}

/** Cues of one segment: its emotion slightly before the voice, and its motions at their words. */
function segmentCues(seg: TimelineSegment, chars: string[], times: CharTime[]): ScoreCue[] {
  const cues: ScoreCue[] = [{ t: ms(Math.max(0, seg.start - 0.15)), emotion: seg.emotion ?? "neutral" }];
  const spokenFrom = (k: number) => {
    for (let i = k; i < chars.length; i++) if (isSpoken(chars[i])) return times[i].start;
    return times.at(-1)?.end ?? seg.start;
  };
  let searchFrom = 0;
  for (const m of seg.motions ?? []) {
    let k = 0;
    if (m.at) {
      k = indexOfWords(chars, m.at, searchFrom);
      if (k < 0) throw new Error(`motion "${m.motion}": "${m.at}" is not in the text "${seg.text}"`);
      searchFrom = k + 1;
    }
    cues.push({ t: ms(spokenFrom(k)), motion: m.motion });
  }
  return cues;
}

/** A score, and the speech mixed onto one track, for audio already spoken. */
export async function compileTimeline(segments: TimelineSegment[], options: TimelineOptions): Promise<{ score: Score; audio: Pcm }> {
  const timing = options.timing ?? alignedTiming;
  const placed = await Promise.all(segments.map(async (seg) => ({ seg, pcm: await readAudio(seg.audio, RATE) })));
  placed.sort((a, b) => a.seg.start - b.seg.start);
  const end = Math.max(0, ...placed.map(({ seg, pcm }) => seg.start + pcm.samples.length / RATE));
  const duration = options.duration ?? end + 0.5;
  const mixed = new Float32Array(Math.ceil(duration * RATE));
  const visemes: VisemeEvent[] = [];
  const speaking: [number, number][] = [];
  const cues: ScoreCue[] = [];
  const captions: Caption[] = [];
  for (const { seg, pcm } of placed) {
    if (seg.start < 0) throw new Error(`segment "${seg.text}" starts before the timeline`);
    const offset = Math.round(seg.start * RATE);
    for (let i = 0; i < pcm.samples.length && offset + i < mixed.length; i++) mixed[offset + i] += pcm.samples[i];
    const chars = Array.from(seg.text);
    const times = (await timing(seg.text, pcm)).map((c) => ({ start: seg.start + c.start, end: seg.start + c.end }));
    if (times.length !== chars.length) throw new Error(`timing for "${seg.text}" has ${times.length} entries, expected ${chars.length}`);
    visemes.push(...(await textVisemes(chars, times)));
    const spoken = times.filter((_, k) => isSpoken(chars[k]));
    if (spoken.length) speaking.push([ms(spoken[0].start), ms(spoken.at(-1)?.end ?? spoken[0].start)]);
    cues.push(...segmentCues(seg, chars, times));
    captions.push(...segmentCaptions(seg.text, times));
  }
  const score: Score = {
    format: "avatarscript-score/1",
    lang: options.lang,
    audio: options.audioName ?? "timeline.wav",
    duration: ms(duration),
    visemes: normalizeEvents(visemes),
    speaking,
    cues: cues.toSorted((a, b) => a.t - b.t),
    captions: joinCaptions(captions).map((c) => ({ start: ms(c.start), end: ms(c.end), text: c.text })),
    subtitles: null,
    view: resolveView(undefined, options.view),
    provenance: { tts: { provider: "external" } },
  };
  return { score, audio: { samples: mixed, sampleRate: RATE } };
}
