// Broad phone classes. The acoustic model emits espeak IPA phonemes; turning text into exact
// phonemes needs a full G2P (espeak-ng, GPL). Summing the model's phonemes into a dozen classes
// and turning the text into the same classes needs only spelling rules, and a misread phoneme
// usually still lands in the right class, which is what timing needs.
import type { Mora } from "../g2p/ja.ts";

export const CLASSES = ["a", "i", "u", "e", "o", "schwa", "nasal", "stop", "fricative", "liquid", "j", "w"] as const;
export type PhoneClass = (typeof CLASSES)[number];
/** A target: one class, or any vowel (English spelling rarely tells which). */
export type Target = PhoneClass | "vowel";
export const VOWEL_CLASSES: readonly PhoneClass[] = ["a", "i", "u", "e", "o", "schwa"];

// leading IPA symbol → class; checked longest first
const IPA: [string, PhoneClass][] = [
  ["ts", "stop"],
  ["tʃ", "stop"],
  ["tɕ", "stop"],
  ["dʒ", "stop"],
  ["dʑ", "stop"],
  ["dz", "stop"],
  ...[..."aɐɑæʌä"].map((c): [string, PhoneClass] => [c, "a"]),
  ...[..."iɪyɨʏ"].map((c): [string, PhoneClass] => [c, "i"]),
  ...[..."uʊɯʉ"].map((c): [string, PhoneClass] => [c, "u"]),
  ...[..."eɛœø"].map((c): [string, PhoneClass] => [c, "e"]),
  ...[..."oɔɒɵ"].map((c): [string, PhoneClass] => [c, "o"]),
  ...[..."əɚɜᵻ"].map((c): [string, PhoneClass] => [c, "schwa"]),
  ...[..."mnŋɲɴNɳ"].map((c): [string, PhoneClass] => [c, "nasal"]),
  ...[..."pbtdkɡgcɟqʔʈɖ"].map((c): [string, PhoneClass] => [c, "stop"]),
  ...[..."fvszʃʒɕʑθðhxçɸβɣχʁħʕʂʐɬSX"].map((c): [string, PhoneClass] => [c, "fricative"]),
  ...[..."lɾrɹɫɭʎɻɽ"].map((c): [string, PhoneClass] => [c, "liquid"]),
  ...[..."jʝ"].map((c): [string, PhoneClass] => [c, "j"]),
  ...[..."wʋ"].map((c): [string, PhoneClass] => [c, "w"]),
];

/** The class of a vocabulary token, or null for tokens that are not phonemes (<s>, <unk>, …). */
export function tokenClass(token: string): PhoneClass | null {
  const t = token.replace(/[\d.ː:^[\]"]/g, "");
  return IPA.find(([lead]) => t.startsWith(lead))?.[1] ?? null;
}

// ---- Japanese: morae → targets ----

// how each kana row starts, by sound (not by mouth shape: ら is a liquid here, not a closed mouth)
const ONSET_ROWS: [string, PhoneClass][] = [
  ["かきくけこがぎぐげごたてとだでどちつぢづざずぜぞじばびぶべぼぱぴぷぺぽ", "stop"],
  ["さしすせそはひへほふゔ", "fricative"],
  ["なにぬねのまみむめも", "nasal"],
  ["らりるれろ", "liquid"],
  ["やゆよ", "j"],
  ["わ", "w"],
];
const ONSET_OF = new Map<string, PhoneClass>();
for (const [kana, cls] of ONSET_ROWS) for (const c of kana) ONSET_OF.set(c, cls);
const toHiragana = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/** Targets of one mora starting with `kana`: its onset class (if any) then its vowel; ん is nasal, っ is silence. */
export function moraTargets(m: Mora, kana: string): Target[] {
  if (m.kind === "n") return ["nasal"];
  if (m.kind === "q") return [];
  const onset = ONSET_OF.get(toHiragana(kana));
  return [...(onset ? [onset] : []), m.vowel];
}

// ---- Latin script: letters → targets ----

const DIGRAPH_TARGETS: Record<string, Target[]> = {
  th: ["fricative"],
  sh: ["fricative"],
  ch: ["stop"],
  ph: ["fricative"],
  wh: ["w"],
  ck: ["stop"],
  ng: ["nasal"],
  gh: [],
  qu: ["stop", "w"],
};
const LETTER_TARGETS: Record<string, Target[]> = {
  b: ["stop"],
  c: ["stop"],
  d: ["stop"],
  g: ["stop"],
  k: ["stop"],
  p: ["stop"],
  q: ["stop"],
  t: ["stop"],
  x: ["stop", "fricative"],
  f: ["fricative"],
  h: ["fricative"],
  s: ["fricative"],
  v: ["fricative"],
  z: ["fricative"],
  j: ["stop"],
  m: ["nasal"],
  n: ["nasal"],
  l: ["liquid"],
  r: ["liquid"],
  w: ["w"],
};
const VOWEL_LETTERS = new Set([..."aeiouy"]);

/** Targets of the single letter w[i] (not part of a digraph). */
function letterTargets(w: string[], i: number): Target[] {
  const c = w[i],
    next = w[i + 1] ?? "";
  if (!VOWEL_LETTERS.has(c)) {
    if (c === w[i - 1]) return []; // doubled consonant
    if (c === "c" && next !== "" && "eiy".includes(next)) return ["fricative"];
    return LETTER_TARGETS[c] ?? [];
  }
  if (c === "y" && i === 0) return ["j"];
  // a run of vowel letters is one vowel sound
  if (VOWEL_LETTERS.has(w[i - 1] ?? "")) return [];
  // a final e after a consonant is silent when a vowel comes before it ("make", not "the")
  const silentE = c === "e" && i === w.length - 1 && i > 0 && w.slice(0, i - 1).some((x) => VOWEL_LETTERS.has(x));
  return silentE ? [] : ["vowel"];
}

/** Targets per letter of one word (a digraph's targets belong to its first letter). */
export function latinTargets(word: string[]): Target[][] {
  const w = word.map((c) => c.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase());
  const out: Target[][] = w.map(() => []);
  let i = 0;
  while (i < w.length) {
    const pair = w[i] + (w[i + 1] ?? "");
    const digraph = pair.length === 2 && Object.hasOwn(DIGRAPH_TARGETS, pair);
    out[i] = digraph ? DIGRAPH_TARGETS[pair] : letterTargets(w, i);
    i += digraph ? 2 : 1;
  }
  return out;
}
