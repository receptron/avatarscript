import { describe, expect, it } from "vitest";
import { refineTiming, silences } from "../src/timing.ts";

const RATE = 8000;
/** Audio that is voiced in the given spans and silent elsewhere. */
function voiced(spans: [number, number][], length: number) {
  const x = new Float32Array(Math.round(length * RATE));
  for (const [a, b] of spans) for (let i = Math.round(a * RATE); i < Math.round(b * RATE); i++) x[i] = 0.3 * Math.sin(i * 0.3);
  return x;
}

describe("refineTiming", () => {
  // "ab、cd": voice at 0.10–0.50 and 0.70–1.10
  const audio = voiced(
    [
      [0.1, 0.5],
      [0.7, 1.1],
    ],
    1.3,
  );

  it("finds the voice and the pause", () => {
    const s = silences(audio, RATE);
    if (!s) throw new Error("no voice found");
    expect(s.onset).toBeCloseTo(0.1, 2);
    expect(s.offset).toBeCloseTo(1.1, 2);
    expect(s.gaps).toHaveLength(1);
    expect(s.gaps[0][0]).toBeCloseTo(0.5, 2);
    expect(s.gaps[0][1]).toBeCloseTo(0.7, 2);
  });

  it("moves late provider timing onto the audio", () => {
    // provider says 0.40 late at the start, and puts the pause 0.2 late
    const timing = [
      [0.5, 0.7],
      [0.7, 0.8],
      [0.8, 0.95],
      [0.95, 1.05],
      [1.05, 1.15],
    ].map(([start, end]) => ({ start, end }));
    const out = refineTiming([..."ab、cd"], timing, audio, RATE);
    expect(out[0].start).toBeCloseTo(0.1, 2);
    expect(out[1].end).toBeCloseTo(0.5, 2);
    expect(out[3].start).toBeCloseTo(0.7, 2);
    expect(out[4].end).toBeCloseTo(1.1, 2);
    for (let i = 1; i < out.length; i++) expect(out[i].start).toBeGreaterThanOrEqual(out[i - 1].start);
  });

  it("leaves timing alone for silent audio", () => {
    const timing = [{ start: 0, end: 0.1 }];
    expect(refineTiming(["a"], timing, new Float32Array(800), RATE)).toBe(timing);
  });
});
