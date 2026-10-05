// Script + TTS → audio and a timed score.
import { concat, silence, type Pcm } from './audio.ts';
import { textVisemes, type CharTime } from './g2p/index.ts';
import type { Score, ScoreCue } from './score.ts';
import type { Script } from './script.ts';
import { isSpoken, refineTiming } from './timing.ts';
import type { TtsAdapter } from './tts/types.ts';
import { normalizeEvents, type VisemeEvent } from './visemes.ts';

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
  onSegment?: (index: number, total: number, text: string) => void;
}

/** Guess the language from the text: Japanese if it has kana or kanji, otherwise English. */
export const detectLang = (text: string) => /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text) ? 'ja' : 'en';

export async function compile(script: Script, tts: TtsAdapter, options: CompileOptions): Promise<{ score: Score; audio: Pcm }> {
  const { lang, leadIn = 0.4, tail = 0.8, gap = 0.1 } = options;
  if (!script.segments.length) throw new Error('the script has nothing to say');
  let sampleRate = 0;
  const parts: Float32Array[] = [];
  const visemes: VisemeEvent[] = [];
  const speaking: [number, number][] = [];
  const cues: ScoreCue[] = [];
  // time of each spoken character, by offset in the plain text
  const charTimes = new Map<number, CharTime>();
  let t = 0;
  const pushSilence = (seconds: number) => {
    if (seconds <= 0) return;
    parts.push(silence(seconds, sampleRate || 24000));
    t += Math.round(seconds * (sampleRate || 24000)) / (sampleRate || 24000);
  };

  for (const [i, seg] of script.segments.entries()) {
    options.onSegment?.(i, script.segments.length, seg.text);
    const syn = await tts.synthesize({
      text: seg.text, lang, emotion: seg.emotion,
      previousText: script.segments[i - 1]?.text, nextText: script.segments[i + 1]?.text,
    });
    if (!sampleRate) sampleRate = syn.sampleRate;
    if (syn.sampleRate !== sampleRate) throw new Error('segments came back at different sample rates');
    pushSilence(i === 0 ? leadIn + seg.pauseBefore : seg.pauseBefore || gap);
    const start = t;
    // the face changes slightly before the voice does
    cues.push({ t: Math.round(Math.max(0, start - 0.15) * 1000) / 1000, emotion: seg.emotion });
    const chars = Array.from(seg.text);
    const times = refineTiming(chars, syn.timing, syn.samples, sampleRate).map(c => ({ start: start + c.start, end: start + c.end }));
    chars.forEach((_, k) => charTimes.set(seg.offset + k, times[k]));
    visemes.push(...await textVisemes(chars, times));
    const spoken = times.filter((_, k) => isSpoken(chars[k]));
    speaking.push([spoken[0]?.start ?? start, spoken[spoken.length - 1]?.end ?? start]);
    parts.push(syn.samples);
    t += syn.samples.length / sampleRate;
  }
  pushSilence(script.pauseAfter + tail);

  // A cue fires with the next spoken character of the same segment; at the end of a segment
  // ("…です！<surprise>") it fires when that segment's last character ends, not in the next one.
  const plainChars = Array.from(script.plain);
  const segmentOf = (offset: number) => script.segments.findIndex(s => offset >= s.offset && offset <= s.offset + Array.from(s.text).length);
  const timeAt = (offset: number) => {
    const k = segmentOf(offset);
    if (k >= 0) {
      const seg = script.segments[k];
      const last = seg.offset + Array.from(seg.text).length - 1;
      for (let o = offset; o <= last; o++) if (isSpoken(plainChars[o])) return charTimes.get(o)!.start;
      return speaking[k][1];
    }
    const next = script.segments.find(s => s.offset > offset);
    return next ? charTimes.get(next.offset)!.start : speaking[speaking.length - 1][1];
  };
  for (const cue of script.cues) {
    const { offset, ...rest } = cue;
    cues.push({ t: Math.round(timeAt(offset) * 1000) / 1000, ...rest } as ScoreCue);
  }
  cues.sort((a, b) => a.t - b.t);

  const score: Score = {
    format: 'avatarscript-score/1',
    lang,
    audio: options.audioName ?? 'audio.wav',
    duration: Math.round(t * 1000) / 1000,
    visemes: normalizeEvents(visemes),
    speaking: speaking.map(([a, b]) => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000]),
    cues,
    provenance: { tts: tts.cacheKey, ...(options.scriptName ? { script: options.scriptName } : {}) },
  };
  return { score, audio: { samples: concat(parts), sampleRate } };
}
