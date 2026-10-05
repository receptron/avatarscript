// Spoken text + per-character timing → viseme events.
import type { Viseme, VisemeEvent } from '../visemes.ts';
import { japaneseVisemes } from './ja.ts';
import { latinVisemes } from './latin.ts';
import type { CharTime } from './types.ts';

export type { CharTime } from './types.ts';

type CharClass = 'ja' | 'latin' | 'space' | 'punct' | 'other';

function classify(c: string): CharClass {
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆ヶ]/u.test(c)) return 'ja';
  if (/\p{Script=Latin}/u.test(c)) return 'latin';
  if (/\s/u.test(c)) return 'space';
  if (/[\p{P}\p{S}]/u.test(c)) return 'punct';
  return 'other';
}

const GENERIC: Viseme[] = ['aa', 'E', 'oh', 'ih'];
const SYLLABLE = 0.16;

/** Plain open–close movement for text we cannot read (digits, other scripts, unknown words). */
export function genericVisemes(s: number, e: number): VisemeEvent[] {
  const out: VisemeEvent[] = [];
  const n = Math.max(1, Math.round((e - s) / SYLLABLE));
  const step = (e - s) / n;
  for (let i = 0; i < n; i++) {
    out.push([s + i * step, GENERIC[i % GENERIC.length]]);
    out.push([s + (i + 0.75) * step, 'nn']);
  }
  return out;
}

/** A pause shorter than this between words keeps the mouth moving. */
const SPACE_CLOSE = 0.12;

export async function textVisemes(chars: string[], times: CharTime[]): Promise<VisemeEvent[]> {
  if (chars.length !== times.length) throw new Error('character timing does not match the text');
  const out: VisemeEvent[] = [];
  let i = 0;
  while (i < chars.length) {
    const cls = classify(chars[i]);
    let j = i + 1;
    // apostrophes stay inside Latin words (don't, l'homme)
    while (j < chars.length) {
      const c = classify(chars[j]);
      if (c === cls) { j++; continue; }
      if (cls === 'latin' && /['’]/.test(chars[j]) && classify(chars[j + 1] ?? '') === 'latin') { j++; continue; }
      break;
    }
    const run = chars.slice(i, j), runTimes = times.slice(i, j);
    const s = runTimes[0].start, e = runTimes[runTimes.length - 1].end;
    if (cls === 'ja') out.push(...await japaneseVisemes(run, runTimes, genericVisemes));
    else if (cls === 'latin') out.push(...latinVisemes(run, runTimes));
    else if (cls === 'space') { if (e - s > SPACE_CLOSE) out.push([s, 'sil']); }
    else if (cls === 'punct') out.push([s, 'sil']);
    else if (e > s) out.push(...genericVisemes(s, e));
    i = j;
  }
  if (times.length) out.push([times[times.length - 1].end, 'sil']);
  return out;
}
