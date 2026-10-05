import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toWav } from "../src/audio.ts";
import { compileTimeline } from "../src/timeline.ts";

let dir = "";
/** A WAV of `seconds` of a quiet tone. */
async function wav(name: string, seconds: number) {
  const samples = Float32Array.from({ length: Math.round(seconds * 24000) }, (_, i) => 0.2 * Math.sin(i / 10));
  const path = join(dir, name);
  await writeFile(path, toWav({ samples, sampleRate: 24000 }));
  return path;
}
// 0.1 s per character, from the start of the audio
const evenTiming = async (text: string) => Array.from(text).map((_, i) => ({ start: i * 0.1, end: (i + 1) * 0.1 }));

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "avatarscript-timeline-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("compileTimeline", () => {
  it("places existing speech on the timeline, with emotions and motions at their words", async () => {
    const segments = [
      { text: "こんにちは", audio: await wav("a.wav", 0.6), start: 1, emotion: "happy" as const, motions: [{ motion: "nod" }] },
      { text: "はい、いいえ。", audio: await wav("b.wav", 0.8), start: 3, motions: [{ motion: "no", at: "いいえ" }] },
    ];
    const { score, audio } = await compileTimeline(segments, { lang: "ja", timing: evenTiming, duration: 5 });
    expect(score.duration).toBe(5);
    expect(audio.samples).toHaveLength(5 * 24000);
    expect(score.speaking).toEqual([
      [1, 1.5],
      [3, 3.6],
    ]);
    expect(score.cues).toEqual([
      { t: 0.85, emotion: "happy" },
      { t: 1, motion: "nod" },
      { t: 2.85, emotion: "neutral" },
      { t: 3.3, motion: "no" },
    ]);
    expect(score.captions.map((c) => c.text)).toEqual(["こんにちは", "はい、いいえ。"]);
    // silence before the first segment: the speech starts at 1 s
    expect(audio.samples[23999]).toBe(0);
    expect(Math.abs(audio.samples[24000 + 5])).toBeGreaterThan(0);
  });

  it("says when a motion's words are not in the text", async () => {
    const segments = [{ text: "はい", audio: await wav("c.wav", 0.3), start: 0, motions: [{ motion: "nod", at: "いいえ" }] }];
    await expect(compileTimeline(segments, { lang: "ja", timing: evenTiming })).rejects.toThrow('"いいえ" is not in the text');
  });
});
