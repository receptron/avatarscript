// Spoken text + per-character timing → viseme events.
import type { Viseme, VisemeEvent } from "../visemes.ts";
import { japaneseVisemes } from "./ja.ts";
import { latinVisemes } from "./latin.ts";
import type { CharTime } from "./types.ts";

export type { CharTime } from "./types.ts";

type CharClass = "ja" | "latin" | "space" | "punct" | "other";

function classify(c: string): CharClass {
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆ヶ]/u.test(c)) return "ja";
  if (/\p{Script=Latin}/u.test(c)) return "latin";
  if (/\s/u.test(c)) return "space";
  if (/[\p{P}\p{S}]/u.test(c)) return "punct";
  return "other";
}

const GENERIC: Viseme[] = ["aa", "E", "oh", "ih"];
const SYLLABLE = 0.16;

/** Plain open–close movement for text we cannot read (digits, other scripts, unknown words). */
export function genericVisemes(s: number, e: number): VisemeEvent[] {
  const out: VisemeEvent[] = [];
  const n = Math.max(1, Math.round((e - s) / SYLLABLE));
  const step = (e - s) / n;
  for (let i = 0; i < n; i++) {
    out.push([s + i * step, GENERIC[i % GENERIC.length]]);
    out.push([s + (i + 0.75) * step, "nn"]);
  }
  return out;
}

/** A pause shorter than this between words keeps the mouth moving. */
const SPACE_CLOSE = 0.12;

/** End (exclusive) of the run of same-class characters starting at i. */
function runEnd(chars: string[], i: number): number {
  const cls = classify(chars[i]);
  let j = i + 1;
  while (j < chars.length) {
    // apostrophes stay inside Latin words (don't, l'homme)
    const apostrophe = cls === "latin" && /['’]/.test(chars[j]) && classify(chars[j + 1] ?? "") === "latin";
    if (classify(chars[j]) !== cls && !apostrophe) break;
    j++;
  }
  return j;
}

async function runVisemes(cls: CharClass, run: string[], times: CharTime[]): Promise<VisemeEvent[]> {
  const s = times[0].start,
    e = times[times.length - 1].end;
  switch (cls) {
    case "ja":
      return japaneseVisemes(run, times, genericVisemes);
    case "latin":
      return latinVisemes(run, times);
    case "space":
      return e - s > SPACE_CLOSE ? [[s, "sil"]] : [];
    case "punct":
      return [[s, "sil"]];
    case "other":
      return e > s ? genericVisemes(s, e) : [];
  }
}

export async function textVisemes(chars: string[], times: CharTime[]): Promise<VisemeEvent[]> {
  if (chars.length !== times.length) throw new Error("character timing does not match the text");
  const out: VisemeEvent[] = [];
  for (let i = 0; i < chars.length;) {
    const j = runEnd(chars, i);
    out.push(...(await runVisemes(classify(chars[i]), chars.slice(i, j), times.slice(i, j))));
    i = j;
  }
  if (times.length) out.push([times[times.length - 1].end, "sil"]);
  return out;
}
