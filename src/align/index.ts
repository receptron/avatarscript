// Character timing from audio for providers that return none (OpenAI, Gemini): the text is known,
// so this is forced alignment, not transcription. The acoustic model's phonemes are summed into
// broad classes, the text is turned into the same classes, and CTC Viterbi finds when each one is
// heard. Characters without a class of their own (spaces, punctuation, silent letters) are placed
// between their neighbours.
import { isKana, kanaMoras, tokenizeJapanese } from "../g2p/ja.ts";
import type { CharTime } from "../g2p/types.ts";
import { latinTargets, moraTargets, VOWEL_CLASSES, type Target } from "./classes.ts";
import { forcedAlign } from "./ctc.ts";
import { classEmissions, classIndex, FRAME_SECONDS, modelDir, type ClassEmissions } from "./model.ts";

/** Characters [from, to) whose sound is `targets`. */
interface Unit {
  from: number;
  to: number;
  targets: Target[];
}

const isJapanese = (c: string) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆ヶ]/u.test(c);
const isLatin = (c: string) => /\p{Script=Latin}/u.test(c);

async function japaneseUnits(chars: string[], at: number): Promise<Unit[]> {
  const units: Unit[] = [];
  let offset = at;
  for (const token of await tokenizeJapanese(chars.join(""))) {
    const surface = Array.from(token.surface);
    if (isKana(token.surface)) {
      // kana: each mora is its own unit, with its own characters
      for (const m of kanaMoras(surface)) units.push({ from: offset + m.from, to: offset + m.from + m.count, targets: moraTargets(m, surface[m.from]) });
    } else {
      // kanji: the reading's targets belong to the whole word
      const reading = token.reading ? Array.from(token.reading) : [];
      units.push({ from: offset, to: offset + surface.length, targets: kanaMoras(reading).flatMap((m) => moraTargets(m, reading[m.from])) });
    }
    offset += surface.length;
  }
  return units;
}

/** The text as units, in order, covering every character. */
async function units(chars: string[]): Promise<Unit[]> {
  const out: Unit[] = [];
  let i = 0;
  while (i < chars.length) {
    let j = i + 1;
    if (isJapanese(chars[i])) {
      while (j < chars.length && isJapanese(chars[j])) j++;
      out.push(...(await japaneseUnits(chars.slice(i, j), i)));
    } else if (isLatin(chars[i])) {
      while (j < chars.length && isLatin(chars[j])) j++;
      latinTargets(chars.slice(i, j)).forEach((targets, k) => out.push({ from: i + k, to: i + k + 1, targets }));
    } else {
      out.push({ from: i, to: j, targets: [] });
    }
    i = j;
  }
  return out;
}

function targetScore(e: ClassEmissions, frame: number, target: Target): number {
  const width = e.logProbs.length / e.frames;
  const row = frame * width;
  if (target !== "vowel") return e.logProbs[row + classIndex(target)];
  // any vowel: log of the summed probabilities
  let sum = 0;
  for (const v of VOWEL_CLASSES) sum += Math.exp(e.logProbs[row + classIndex(v)]);
  return Math.log(sum + 1e-12);
}

interface UnitAlignment {
  /** seconds per unit; null where the alignment failed or a unit has no targets */
  times: ([number, number] | null)[];
  /**
   * How far the forced path is from what the model hears, in nats per frame (0 = it hears exactly
   * the text). Audio that says something else (an instruction read aloud, a skipped sentence) has
   * frames the text cannot explain, and this grows.
   */
  mismatch: number;
}

function alignUnits(e: ClassEmissions, list: Unit[]): UnitAlignment {
  const targets = list.flatMap((u) => u.targets);
  const width = e.logProbs.length / e.frames;
  const score = (t: number, k: number) => targetScore(e, t, targets[k]);
  const spans = forcedAlign({ frames: e.frames, blank: (t) => e.logProbs[t * width], score }, targets.length, (k) => k > 0 && targets[k] === targets[k - 1]);
  if (!spans) return { times: list.map(() => null), mismatch: Infinity };
  // the path's log-probability per frame against the best the model gives that frame
  const path = Array.from({ length: e.frames }, (_, t) => e.logProbs[t * width]);
  spans.forEach(([a, b], k) => {
    for (let t = a; t <= b; t++) path[t] = score(t, k);
  });
  let gap = 0;
  for (let t = 0; t < e.frames; t++) gap += Math.max(...e.logProbs.subarray(t * width, (t + 1) * width)) - path[t];
  let k = 0;
  const times = list.map((u): [number, number] | null => {
    if (!u.targets.length) return null;
    const first = spans[k],
      last = spans[k + u.targets.length - 1];
    k += u.targets.length;
    return [first[0] * FRAME_SECONDS, (last[1] + 1) * FRAME_SECONDS];
  });
  return { times, mismatch: gap / Math.max(1, e.frames) };
}

export interface TextAlignment {
  timing: CharTime[];
  /** see UnitAlignment.mismatch */
  mismatch: number;
}

/** Character timing for `text` spoken in `samples`, and how well the audio matches the text. */
export async function alignText(text: string, samples: Float32Array, sampleRate: number): Promise<TextAlignment> {
  const e = await classEmissions(samples, sampleRate, (what) => console.warn(`downloading the alignment model ${what} to ${modelDir()}`));
  return alignEmissions(text, e, samples.length / sampleRate);
}

/** alignText() for emissions already computed; `duration` is the audio's length in seconds. */
export async function alignEmissions(text: string, e: ClassEmissions, duration: number): Promise<TextAlignment> {
  const chars = Array.from(text);
  const list = await units(chars);
  const { times, mismatch } = alignUnits(e, list);
  const timing: CharTime[] = chars.map(() => ({ start: 0, end: 0 }));
  list.forEach((u, i) => {
    // a unit without a sound of its own fills the gap between its neighbours
    const own = times[i];
    const start = own?.[0] ?? times.slice(0, i).findLast((t) => t)?.[1] ?? 0;
    const end = own?.[1] ?? times.slice(i + 1).find((t) => t)?.[0] ?? duration;
    const n = u.to - u.from;
    for (let c = u.from; c < u.to; c++) {
      const k = c - u.from;
      timing[c] = { start: start + ((end - start) * k) / n, end: start + ((end - start) * (k + 1)) / n };
    }
  });
  return { timing, mismatch };
}
