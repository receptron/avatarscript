import { describe, expect, it } from "vitest";
import { parseScript, plainScript } from "../src/script.ts";

describe("parseScript", () => {
  it("splits segments at emotion changes and pauses and keeps the text unchanged", () => {
    const s = parseScript("---\nlang: ja\n---\n[emotion:happy] こんにちは！<nod> ミコです。\n[pause:300ms]\n[emotion:sad] *本当*に？");
    expect(s.meta).toEqual({ lang: "ja" });
    expect(s.plain).toBe(" こんにちは！ ミコです。\n\n 本当に？");
    expect(s.segments).toEqual([
      { text: "こんにちは！ ミコです。", offset: 1, emotion: "happy", pauseBefore: 0 },
      { text: "本当に？", offset: 16, emotion: "sad", pauseBefore: 0.3 },
    ]);
    expect(s.cues).toEqual([
      { offset: 7, motion: "nod" },
      { offset: 16, emphasis: true },
    ]);
  });

  it("reads escapes, gaze and several tags at once", () => {
    const s = parseScript("Price \\[1\\] \\*now\\* [gaze:left pause:1s] ok");
    expect(s.plain).toBe("Price [1] *now*  ok");
    expect(s.segments.map((x) => [x.text, x.pauseBefore])).toEqual([
      ["Price [1] *now*", 0],
      ["ok", 1],
    ]);
    expect(s.cues).toEqual([{ offset: 16, gaze: "left" }]);
  });

  it("reports mistakes with a line number", () => {
    expect(() => parseScript("hi\n[emotion:bored] x")).toThrow('line 2: unknown emotion "bored"');
    expect(() => parseScript("[pause:3]")).toThrow("pause must look like");
    expect(() => parseScript("*open")).toThrow("not closed");
    expect(() => parseScript("<bad name>")).toThrow("motion names");
  });

  it("treats plain text as one neutral segment", () => {
    expect(plainScript("  Hello [world]  ").segments).toEqual([{ text: "Hello [world]", offset: 2, emotion: "neutral", pauseBefore: 0 }]);
  });
});
