import { describe, expect, it } from "vitest";
import { CLASSES, latinTargets, moraTargets, tokenClass, type PhoneClass } from "../src/align/classes.ts";
import { forcedAlign } from "../src/align/ctc.ts";
import { alignEmissions } from "../src/align/index.ts";
import { FRAME_SECONDS, type ClassEmissions } from "../src/align/model.ts";
import { kanaMoras } from "../src/g2p/ja.ts";

describe("phone classes", () => {
  it("sorts the model's IPA tokens into classes", () => {
    const cases: [string, PhoneClass | null][] = [
      ["a", "a"],
      ["aɪ", "a"],
      ["i5", "i"],
      ["ɯ", "u"],
      ["tʃ", "stop"],
      ["ts", "stop"],
      ["ɕ", "fricative"],
      ["ɾ", "liquid"],
      ["ŋ", "nasal"],
      ["<pad>", null],
      ["<unk>", null],
    ];
    for (const [token, cls] of cases) expect([token, tokenClass(token)]).toEqual([token, cls]);
  });

  it("turns kana into targets by sound", () => {
    const targets = (kana: string) => kanaMoras([...kana]).map((m) => moraTargets(m, kana[m.from]));
    expect(targets("きょう")).toEqual([["stop", "o"], ["u"]]);
    expect(targets("らん")).toEqual([["liquid", "a"], ["nasal"]]);
    expect(targets("まった")).toEqual([["nasal", "a"], [], ["stop", "a"]]);
    expect(targets("はし")).toEqual([
      ["fricative", "a"],
      ["fricative", "i"],
    ]);
  });

  it("turns spelling into targets, one list per letter", () => {
    expect(latinTargets([..."write"])).toEqual([["w"], ["liquid"], ["vowel"], ["stop"], []]);
    expect(latinTargets([..."the"])).toEqual([["fricative"], [], ["vowel"]]);
    expect(latinTargets([..."you"])).toEqual([["j"], [], []]);
    expect(latinTargets([..."speech"])).toEqual([["fricative"], ["stop"], ["vowel"], [], ["stop"], []]);
  });
});

/** Emissions where each frame is certain of one class (or blank). */
function emissions(frames: ("_" | PhoneClass)[]): ClassEmissions {
  const width = 1 + CLASSES.length;
  const logProbs = new Float32Array(frames.length * width).fill(Math.log(1e-6));
  frames.forEach((f, t) => {
    logProbs[t * width + (f === "_" ? 0 : 1 + CLASSES.indexOf(f))] = 0;
  });
  return { frames: frames.length, logProbs };
}

describe("forcedAlign", () => {
  const e = emissions(["_", "_", "a", "a", "a", "_", "stop", "stop", "_", "_"]);
  const width = 1 + CLASSES.length;
  const score = (t: number, k: number) => e.logProbs[t * width + 1 + CLASSES.indexOf(k === 0 ? "a" : "stop")];

  it("finds each target's frames", () => {
    expect(forcedAlign({ frames: e.frames, blank: (t) => e.logProbs[t * width], score }, 2, () => false)).toEqual([
      [2, 4],
      [6, 7],
    ]);
  });

  it("gives up when the audio is too short for the text", () => {
    expect(forcedAlign({ frames: 1, blank: () => 0, score: () => 0 }, 2, () => false)).toBeNull();
  });
});

describe("alignEmissions", () => {
  it("times each character and fills punctuation between its neighbours", async () => {
    // "ma." spoken: m at frames 2–3, a at 4–7, then silence
    const e = emissions(["_", "_", "nasal", "nasal", "a", "a", "a", "a", "_", "_"]);
    const { timing, mismatch } = await alignEmissions("ま.", e, 10 * FRAME_SECONDS);
    // ま is one mora: one character holding both targets
    expect(timing[0].start).toBeCloseTo(2 * FRAME_SECONDS);
    expect(timing[0].end).toBeCloseTo(8 * FRAME_SECONDS);
    expect(timing[1].start).toBeCloseTo(8 * FRAME_SECONDS);
    expect(mismatch).toBeLessThan(0.01);
  });

  it("reports audio that says something else", async () => {
    const e = emissions(["_", "fricative", "i", "stop", "o", "_", "nasal", "a", "_", "_"]);
    expect((await alignEmissions("ま", e, 10 * FRAME_SECONDS)).mismatch).toBeGreaterThan(1);
  });
});
