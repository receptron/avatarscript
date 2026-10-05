// Japanese: kana → morae → visemes. Kanji get their reading from kuromoji; kana keep the timing
// the TTS reported for each character.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import kuromoji from 'kuromoji';
import type { Viseme, VisemeEvent } from '../visemes.ts';
import type { CharTime } from './types.ts';

type Vowel = 'a' | 'i' | 'u' | 'e' | 'o';
const VOWEL_VISEME: Record<Vowel, Viseme> = { a: 'aa', i: 'ih', u: 'ou', e: 'E', o: 'oh' };

const ROWS: Record<Vowel, string> = {
  a: 'あかさたなはまやらわがざだばぱぁゃゎ',
  i: 'いきしちにひみりぎじぢびぴぃ',
  u: 'うくすつぬふむゆるぐずづぶぷぅゅゔ',
  e: 'えけせてねへめれげぜでべぺぇ',
  o: 'おこそとのほもよろをごぞどぼぽぉょ',
};
const VOWEL_OF = new Map<string, Vowel>();
for (const [v, chars] of Object.entries(ROWS) as [Vowel, string][]) for (const c of chars) VOWEL_OF.set(c, v);

// how the mouth starts each mora
const ONSETS: [string, Viseme][] = [
  ['まみむめもばびぶべぼぱぴぷぺぽ', 'PP'],
  ['ふゔ', 'FF'],
  ['かきくけこがぎぐげご', 'kk'],
  ['さすせそざずぜぞ', 'SS'],
  ['しじちぢ', 'CH'],
  ['たつてとだづでどらりるれろ', 'DD'],
  ['なにぬねの', 'nn'],
  ['やゆよ', 'ih'],
  ['わを', 'ou'],
];
const ONSET_OF = new Map<string, Viseme>();
for (const [chars, v] of ONSETS) for (const c of chars) ONSET_OF.set(c, v);
const SMALL = new Set([...'ゃゅょぁぃぅぇぉゎ']);

const toHiragana = (s: string) => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
export const isKana = (s: string) => /^[ぁ-ゖァ-ヶー]+$/.test(s);

export interface Mora {
  kind: 'vowel' | 'n' | 'q';
  vowel?: Vowel;
  onset: Viseme | null;
  /** index of the first source character and how many it spans */
  from: number;
  count: number;
}

/** Splits kana into morae. Small kana and ー join the previous mora. */
export function kanaMoras(kana: string[]): Mora[] {
  const out: Mora[] = [];
  kana.forEach((raw, i) => {
    const c = toHiragana(raw);
    const last = out[out.length - 1];
    if ((SMALL.has(c) || c === 'ー') && last) {
      if (SMALL.has(c)) last.vowel = VOWEL_OF.get(c) ?? last.vowel;
      last.count = i - last.from + 1;
      return;
    }
    if (c === 'っ') { out.push({ kind: 'q', onset: null, from: i, count: 1 }); return; }
    if (c === 'ん') { out.push({ kind: 'n', onset: null, from: i, count: 1 }); return; }
    const vowel = VOWEL_OF.get(c);
    if (vowel) out.push({ kind: 'vowel', vowel, onset: ONSET_OF.get(c) ?? null, from: i, count: 1 });
  });
  return out;
}

/** Visemes of one mora spanning [s, e]. */
function moraVisemes(m: Mora, s: number, e: number): VisemeEvent[] {
  if (m.kind === 'q') return [[s, 'sil']];
  if (m.kind === 'n') return [[s, 'nn']];
  const v = VOWEL_VISEME[m.vowel!];
  if (!m.onset) return [[s, v]];
  // lips stay closed a little longer than other consonants
  const share = m.onset === 'PP' ? 0.3 : 0.2;
  return [[s, m.onset], [s + (e - s) * share, v]];
}

let tokenizer: Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>> | null = null;
function getTokenizer() {
  if (!tokenizer) {
    const dicPath = join(dirname(createRequire(import.meta.url).resolve('kuromoji/package.json')), 'dict');
    tokenizer = new Promise((res, rej) => kuromoji.builder({ dicPath }).build((err, t) => err ? rej(err) : res(t)));
  }
  return tokenizer;
}

/**
 * Visemes for a run of Japanese characters. Returns null for tokens whose reading is unknown,
 * so the caller can fall back to generic mouth movement for them.
 */
export async function japaneseVisemes(chars: string[], times: CharTime[],
  fallback: (s: number, e: number) => VisemeEvent[]): Promise<VisemeEvent[]> {
  const t = await getTokenizer();
  const out: VisemeEvent[] = [];
  let at = 0;
  for (const token of t.tokenize(chars.join(''))) {
    const surface = Array.from(token.surface_form);
    const from = at, to = at + surface.length;
    at = to;
    const s = times[from].start, e = times[to - 1].end;
    if (isKana(token.surface_form)) {
      // kana: each mora gets the timing of its own characters
      for (const m of kanaMoras(surface)) {
        out.push(...moraVisemes(m, times[from + m.from].start, times[from + m.from + m.count - 1].end));
      }
      continue;
    }
    const reading = token.reading && token.reading !== '*' ? Array.from(token.reading) : null;
    const moras = reading ? kanaMoras(reading) : [];
    if (!moras.length) { out.push(...fallback(s, e)); continue; }
    // kanji: spread the reading's morae evenly over the characters' time span
    const weight = (m: Mora) => m.count * (m.kind === 'vowel' ? 1 : 0.8);
    const total = moras.reduce((n, m) => n + weight(m), 0);
    let ms = s;
    for (const m of moras) {
      const me = ms + (e - s) * weight(m) / total;
      out.push(...moraVisemes(m, ms, me));
      ms = me;
    }
  }
  return out;
}
