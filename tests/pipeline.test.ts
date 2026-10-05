import { describe, expect, it } from "vitest";
import { fromWav, toWav, frameLevels } from "../src/audio.ts";
import { compile } from "../src/compile.ts";
import { planFrames } from "../src/render.ts";
import { parseScript } from "../src/script.ts";
import { createTts } from "../src/tts/index.ts";
import { alignToText } from "../src/tts/elevenlabs.ts";

describe("audio", () => {
  it("round-trips WAV", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const back = fromWav(toWav({ samples, sampleRate: 24000 }));
    expect(back.sampleRate).toBe(24000);
    expect([...back.samples].map((v) => Math.round(v * 100) / 100)).toEqual([0, 0.5, -0.5, 1, -1]);
  });
});

describe("ElevenLabs timing", () => {
  const alignment = (s: string) => ({
    characters: [...s],
    character_start_times_seconds: [...s].map((_, i) => i / 10),
    character_end_times_seconds: [...s].map((_, i) => (i + 1) / 10),
  });
  it("skips an emotion tag the adapter added in front", () => {
    expect(alignToText("ok", alignment("[happy] ok"), 8)).toEqual([
      { start: 0.8, end: 0.9 },
      { start: 0.9, end: 1 },
    ]);
  });
  it("refuses timing for different text", () => {
    expect(() => alignToText("ok", alignment("no"), 0)).toThrow("does not match");
  });
});

describe("compile", () => {
  it("places segments, pauses and cues on one timeline", async () => {
    const script = parseScript("[emotion:happy] はい！<nod> [pause:500ms] [emotion:sad] いいえ。<sigh>");
    const { score, audio } = await compile(script, createTts({ provider: "mock" }), { lang: "ja", leadIn: 0.4, tail: 0.8 });
    expect(score.speaking).toHaveLength(2);
    const [[, end1], [start2]] = score.speaking;
    expect(start2 - end1).toBeGreaterThan(0.5);
    expect(audio.samples.length / audio.sampleRate).toBeCloseTo(score.duration, 2);
    const motions = score.cues.filter((c) => "motion" in c);
    const emotions = score.cues.filter((c) => "emotion" in c);
    // a motion at the end of a line fires in that line, before the next emotion
    expect(motions[0].t).toBeLessThan(start2);
    expect(motions[1].t).toBeLessThanOrEqual(score.speaking[1][1]);
    expect(emotions.map((c) => "emotion" in c && c.emotion)).toEqual(["happy", "sad"]);
    expect(score.visemes.at(-1)?.[1]).toBe("sil");
  });

  it("plans mouth, speech and actions per frame", async () => {
    const { score, audio } = await compile(parseScript("[emotion:happy] まま<nod>"), createTts({ provider: "mock" }), { lang: "ja" });
    const frames = Math.ceil(score.duration * 30);
    const plans = planFrames(score, frameLevels(audio, 30, frames), 30, 0);
    expect(plans).toHaveLength(frames);
    expect(plans.flatMap((p) => p.actions)).toEqual([
      ["emotion", "happy"],
      ["motion", "nod"],
    ]);
    expect(new Set(plans.filter((p) => p.speaking).map((p) => p.mouth))).toEqual(new Set(["n", "a"]));
    expect(plans[0]).toMatchObject({ mouth: null, speaking: false, level: 0, caption: null });
    // captions are planned only when subtitles are drawn
    const withCaptions = planFrames(score, frameLevels(audio, 30, frames), 30, 0, true);
    expect(new Set(withCaptions.map((p) => p.caption))).toEqual(new Set([null, "まま"]));
  });
});
