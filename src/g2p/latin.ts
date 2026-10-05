// Latin-script words → visemes, letter by letter. The TTS reports when each letter is spoken,
// so spelling rules only need to pick a mouth shape, not a duration. This is an approximation
// tuned for English that is also usable for other Latin-script languages.
import type { Viseme, VisemeEvent } from "../visemes.ts";
import type { CharTime } from "./types.ts";

const DIGRAPHS: Record<string, Viseme | null> = {
  th: "TH",
  sh: "CH",
  ch: "CH",
  ph: "FF",
  wh: "ou",
  ck: "kk",
  ng: "nn",
  gh: null,
  oo: "ou",
  ee: "ih",
  ea: "ih",
  ie: "ih",
  ai: "E",
  ay: "E",
  ei: "E",
  ey: "E",
  oa: "oh",
  ou: "oh",
  ow: "oh",
  au: "oh",
  aw: "oh",
};
const LETTERS: Record<string, Viseme | null> = {
  a: "aa",
  e: "E",
  i: "ih",
  o: "oh",
  u: "aa",
  y: "ih",
  b: "PP",
  m: "PP",
  p: "PP",
  f: "FF",
  v: "FF",
  t: "DD",
  d: "DD",
  l: "DD",
  n: "nn",
  k: "kk",
  g: "kk",
  q: "kk",
  x: "kk",
  c: "kk",
  s: "SS",
  z: "SS",
  j: "CH",
  r: "RR",
  w: "ou",
  h: null,
};
const VOWELS = new Set([..."aeiouy"]);

const base = (c: string) => c.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The mouth shape for letter i, or null when it adds none (silent e, doubled consonant, h). */
function letterViseme(w: string[], word: string[], i: number): Viseme | null {
  const c = w[i],
    next = w[i + 1] ?? "",
    last = w.length - 1;
  if (c === next && !VOWELS.has(c)) return null; // doubled consonant
  if (word[i].toLowerCase() === "e" && i === last && w.length > 2 && !VOWELS.has(w[i - 1])) return null; // silent e
  if (c === "c" && next !== "" && "eiy".includes(next)) return "SS";
  if (c === "u" && (i === last || w[i - 1] === "q" || (i + 2 === last && w[i + 2] === "e"))) return "ou";
  return Object.hasOwn(LETTERS, c) ? LETTERS[c] : null;
}

/** Visemes for one word; letters that map to nothing extend the previous shape. */
export function latinVisemes(word: string[], times: CharTime[]): VisemeEvent[] {
  const w = word.map(base);
  const out: VisemeEvent[] = [];
  let i = 0;
  while (i < w.length) {
    const pair = w[i] + (w[i + 1] ?? "");
    const digraph = pair.length === 2 && Object.hasOwn(DIGRAPHS, pair);
    const v = digraph ? DIGRAPHS[pair] : letterViseme(w, word, i);
    if (v) out.push([times[i].start, v]);
    i += digraph ? 2 : 1;
  }
  return out;
}
