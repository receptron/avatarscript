// Japanese: kana → morae → visemes. Kanji get their reading from kuromoji; kana keep the timing
// the TTS reported for each character.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import kuromoji from "kuromoji";
import type { Viseme, VisemeEvent } from "../visemes.ts";
import type { CharTime } from "./types.ts";

type Vowel = "a" | "i" | "u" | "e" | "o";
const VOWEL_VISEME: Record<Vowel, Viseme> = { a: "aa", i: "ih", u: "ou", e: "E", o: "oh" };

const ROWS: [Vowel, string][] = [
  ["a", "あかさたなはまやらわがざだばぱぁゃゎ"],
  ["i", "いきしちにひみりぎじぢびぴぃ"],
  ["u", "うくすつぬふむゆるぐずづぶぷぅゅゔ"],
  ["e", "えけせてねへめれげぜでべぺぇ"],
  ["o", "おこそとのほもよろをごぞどぼぽぉょ"],
];
const VOWEL_OF = new Map<string, Vowel>();
for (const [v, chars] of ROWS) for (const c of chars) VOWEL_OF.set(c, v);

// how the mouth starts each mora
const ONSETS: [string, Viseme][] = [
  ["まみむめもばびぶべぼぱぴぷぺぽ", "PP"],
  ["ふゔ", "FF"],
  ["かきくけこがぎぐげご", "kk"],
  ["さすせそざずぜぞ", "SS"],
  ["しじちぢ", "CH"],
  ["たつてとだづでどらりるれろ", "DD"],
  ["なにぬねの", "nn"],
  ["やゆよ", "ih"],
  ["わを", "ou"],
];
const ONSET_OF = new Map<string, Viseme>();
for (const [chars, v] of ONSETS) for (const c of chars) ONSET_OF.set(c, v);
const SMALL = new Set([..."ゃゅょぁぃぅぇぉゎ"]);

const toHiragana = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
export const isKana = (s: string) => /^[ぁ-ゖァ-ヶー]+$/.test(s);

/** A mora: a vowel (with how the mouth starts it), ん, or っ; `from`/`count` locate its source characters. */
export type Mora =
  | { kind: "vowel"; vowel: Vowel; onset: Viseme | null; from: number; count: number }
  | { kind: "n"; from: number; count: number }
  | { kind: "q"; from: number; count: number };

/** Splits kana into morae. Small kana and ー join the previous mora. */
export function kanaMoras(kana: string[]): Mora[] {
  const out: Mora[] = [];
  kana.forEach((raw, i) => {
    const c = toHiragana(raw);
    const last = out[out.length - 1];
    if ((SMALL.has(c) || c === "ー") && last) {
      if (SMALL.has(c) && last.kind === "vowel") last.vowel = VOWEL_OF.get(c) ?? last.vowel;
      last.count = i - last.from + 1;
      return;
    }
    if (c === "っ") {
      out.push({ kind: "q", from: i, count: 1 });
      return;
    }
    if (c === "ん") {
      out.push({ kind: "n", from: i, count: 1 });
      return;
    }
    const vowel = VOWEL_OF.get(c);
    if (vowel) out.push({ kind: "vowel", vowel, onset: ONSET_OF.get(c) ?? null, from: i, count: 1 });
  });
  return out;
}

/** Visemes of one mora spanning [s, e]. */
function moraVisemes(m: Mora, s: number, e: number): VisemeEvent[] {
  if (m.kind === "q") return [[s, "sil"]];
  if (m.kind === "n") return [[s, "nn"]];
  const v = VOWEL_VISEME[m.vowel];
  if (!m.onset) return [[s, v]];
  // lips stay closed a little longer than other consonants
  const share = m.onset === "PP" ? 0.3 : 0.2;
  return [
    [s, m.onset],
    [s + (e - s) * share, v],
  ];
}

let tokenizer: Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>> | null = null;
function getTokenizer() {
  if (!tokenizer) {
    const dicPath = join(dirname(createRequire(import.meta.url).resolve("kuromoji/package.json")), "dict");
    tokenizer = new Promise((res, rej) => kuromoji.builder({ dicPath }).build((err, t) => (err ? rej(err) : res(t))));
  }
  return tokenizer;
}

type Fallback = (s: number, e: number) => VisemeEvent[];

/** Visemes of one token whose characters have the given timing. */
function tokenVisemes(token: kuromoji.IpadicFeatures, times: CharTime[], fallback: Fallback): VisemeEvent[] {
  const surface = Array.from(token.surface_form);
  // kana: each mora gets the timing of its own characters
  if (isKana(token.surface_form)) return kanaMoras(surface).flatMap((m) => moraVisemes(m, times[m.from].start, times[m.from + m.count - 1].end));
  const s = times[0].start,
    e = times[times.length - 1].end;
  const moras = token.reading && token.reading !== "*" ? kanaMoras(Array.from(token.reading)) : [];
  if (!moras.length) return fallback(s, e);
  // kanji: spread the reading's morae evenly over the characters' time span
  const weight = (m: Mora) => m.count * (m.kind === "vowel" ? 1 : 0.8);
  const total = moras.reduce((n, m) => n + weight(m), 0);
  let ms = s;
  return moras.flatMap((m) => {
    const me = ms + ((e - s) * weight(m)) / total;
    const events = moraVisemes(m, ms, me);
    ms = me;
    return events;
  });
}

/**
 * Visemes for a run of Japanese characters. Tokens whose reading is unknown get the caller's
 * generic mouth movement.
 */
export async function japaneseVisemes(chars: string[], times: CharTime[], fallback: Fallback): Promise<VisemeEvent[]> {
  const t = await getTokenizer();
  let at = 0;
  return t.tokenize(chars.join("")).flatMap((token) => {
    const from = at;
    at += Array.from(token.surface_form).length;
    return tokenVisemes(token, times.slice(from, at), fallback);
  });
}
