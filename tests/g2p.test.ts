import { describe, expect, it } from "vitest";
import { textVisemes } from "../src/g2p/index.ts";
import { kanaMoras } from "../src/g2p/ja.ts";
import { latinVisemes } from "../src/g2p/latin.ts";

const even = (n: number, d = 0.1) => Array.from({ length: n }, (_, i) => ({ start: i * d, end: (i + 1) * d }));
const shapes = (events: [number, string][]) => events.map((e) => e[1]);

describe("Japanese", () => {
  it("joins small kana and long marks to the previous mora", () => {
    const m = kanaMoras([..."きょうはー"]);
    expect(m.map((x) => [x.kind === "vowel" ? x.vowel : x.kind, x.from, x.count])).toEqual([
      ["o", 0, 2],
      ["u", 2, 1],
      ["a", 3, 2],
    ]);
  });

  it("reads kanji through kuromoji and uses each kana character’s own timing", async () => {
    const v = await textVisemes([..."今日はみんな"], even(6));
    // キョウ (kanji, spread over 今日), は, み, ん, な
    expect(shapes(v)).toEqual(["kk", "oh", "ou", "aa", "PP", "ih", "nn", "nn", "aa", "sil"]);
    expect(v.find((e) => e[1] === "PP")?.[0]).toBeCloseTo(0.3);
  });
});

describe("Latin", () => {
  it("maps letters and digraphs to mouth shapes", () => {
    expect(shapes(latinVisemes([..."think"], even(5)))).toEqual(["TH", "ih", "nn", "kk"]);
    expect(shapes(latinVisemes([..."make"], even(4)))).toEqual(["PP", "aa", "kk"]);
    expect(shapes(latinVisemes([..."Café"], even(4)))).toEqual(["kk", "aa", "FF", "E"]);
    // a final c is hard: nothing follows it to soften it
    expect(shapes(latinVisemes([..."music"], even(5)))).toEqual(["PP", "aa", "SS", "ih", "kk"]);
  });

  it("closes the mouth only for real pauses between words", async () => {
    const times = [...even(2), { start: 0.2, end: 0.25 }, ...even(2).map((t) => ({ start: t.start + 0.25, end: t.end + 0.25 }))];
    expect(shapes(await textVisemes([..."hi yo"], times))).toEqual(["ih", "ih", "oh", "sil"]);
  });

  it("moves the mouth for text it cannot read", async () => {
    expect(shapes(await textVisemes([..."42"], even(2, 0.16)))).toEqual(["aa", "nn", "E", "nn", "sil"]);
  });
});
