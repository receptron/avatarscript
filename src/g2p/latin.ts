// Latin-script words → visemes, letter by letter. The TTS reports when each letter is spoken,
// so spelling rules only need to pick a mouth shape, not a duration. This is an approximation
// tuned for English that is also usable for other Latin-script languages.
import type { Viseme, VisemeEvent } from '../visemes.ts';
import type { CharTime } from './types.ts';

const DIGRAPHS: Record<string, Viseme | null> = {
  th: 'TH', sh: 'CH', ch: 'CH', ph: 'FF', wh: 'ou', ck: 'kk', ng: 'nn', gh: null,
  oo: 'ou', ee: 'ih', ea: 'ih', ie: 'ih', ai: 'E', ay: 'E', ei: 'E', ey: 'E',
  oa: 'oh', ou: 'oh', ow: 'oh', au: 'oh', aw: 'oh',
};
const LETTERS: Record<string, Viseme | null> = {
  a: 'aa', e: 'E', i: 'ih', o: 'oh', u: 'aa', y: 'ih',
  b: 'PP', m: 'PP', p: 'PP', f: 'FF', v: 'FF',
  t: 'DD', d: 'DD', l: 'DD', n: 'nn',
  k: 'kk', g: 'kk', q: 'kk', x: 'kk', c: 'kk',
  s: 'SS', z: 'SS', j: 'CH', r: 'RR', w: 'ou', h: null,
};
const VOWELS = new Set([...'aeiouy']);

const base = (c: string) => c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Visemes for one word; letters that map to nothing extend the previous shape. */
export function latinVisemes(word: string[], times: CharTime[]): VisemeEvent[] {
  const w = word.map(base);
  const out: VisemeEvent[] = [];
  for (let i = 0; i < w.length; i++) {
    const c = w[i], next = w[i + 1] ?? '';
    const pair = DIGRAPHS[c + next];
    if (pair !== undefined) {
      if (pair) out.push([times[i].start, pair]);
      i++;
      continue;
    }
    if (c === next && !VOWELS.has(c)) continue;                     // doubled consonant
    if (word[i].toLowerCase() === 'e' && i === w.length - 1 && w.length > 2 && !VOWELS.has(w[i - 1])) continue; // silent e
    let v = LETTERS[c];
    if (c === 'c' && 'eiy'.includes(next)) v = 'SS';
    if (c === 'u' && (i === w.length - 1 || w[i - 1] === 'q' || (w[i + 2] === 'e' && i + 2 === w.length - 1))) v = 'ou';
    if (v) out.push([times[i].start, v]);
  }
  return out;
}
