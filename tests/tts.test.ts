import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toWav } from "../src/audio.ts";
import { decodeGeminiAudio } from "../src/tts/gemini.ts";
import { createTts, normalizeSpeech, SPEECH_SAMPLE_RATE } from "../src/tts/index.ts";

const request = { text: "はい", lang: "ja", emotion: "neutral" } as const;

describe("createTts", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("takes the provider as a parameter and returns the common shape", async () => {
    const tts = createTts({ provider: "mock" });
    expect([tts.provider, tts.model, tts.voice]).toEqual(["mock", "buzz", "buzz"]);
    const speech = await tts.synthesize(request);
    expect(speech.sampleRate).toBe(SPEECH_SAMPLE_RATE);
    expect(speech.timing).toHaveLength(2);
  });

  it("rejects an unknown provider and stray settings", () => {
    // @ts-expect-error: not a provider
    expect(() => createTts({ provider: "acme" })).toThrow("text-to-speech config is not valid");
    // @ts-expect-error: not a setting
    expect(() => createTts({ provider: "mock", voiceId: "x" })).toThrow("voiceId");
  });

  it("needs the provider's API key, from the config or its environment variable", () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    expect(() => createTts({ provider: "elevenlabs" })).toThrow("elevenlabs needs an API key: pass apiKey or set ELEVENLABS_API_KEY");
    expect(createTts({ provider: "elevenlabs", apiKey: "k" }).model).toBe("eleven_v3");
    vi.stubEnv("ELEVENLABS_API_KEY", "from-env");
    expect(createTts({ provider: "elevenlabs", voice: "v" }).voice).toBe("v");
  });

  it("knows OpenAI and Gemini, each with its own key and defaults", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(() => createTts({ provider: "openai" })).toThrow("set OPENAI_API_KEY");
    expect(() => createTts({ provider: "gemini" })).toThrow("set GEMINI_API_KEY");
    const openai = createTts({ provider: "openai", apiKey: "k" });
    expect([openai.model, openai.voice]).toEqual(["gpt-4o-mini-tts", "coral"]);
    const gemini = createTts({ provider: "gemini", apiKey: "k" });
    expect([gemini.model, gemini.voice]).toEqual(["gemini-3.8-flash-tts", "Kore"]);
    expect(() => createTts({ provider: "openai", apiKey: "k", options: { speed: 9 } })).toThrow("openai options is not valid");
  });

  it("checks provider-specific options", () => {
    expect(() => createTts({ provider: "elevenlabs", apiKey: "k", options: { seed: -1 } })).toThrow("elevenlabs options is not valid");
  });

  it("caches speech on disk and reuses it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "avatarscript-tts-"));
    try {
      const first = await createTts({ provider: "mock", cacheDir: dir }).synthesize(request);
      expect(await readdir(dir)).toHaveLength(1);
      const again = await createTts({ provider: "mock", cacheDir: dir }).synthesize(request);
      expect(again.timing).toEqual(first.timing);
      expect([...again.samples]).toEqual([...first.samples]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("normalizeSpeech", () => {
  const timing = [
    { start: 0, end: 0.5 },
    { start: 0.5, end: 2 },
  ];

  it("resamples to the common rate and keeps timing inside the audio", () => {
    const speech = normalizeSpeech({ samples: new Float32Array(44100), sampleRate: 44100, timing }, "ab", "x");
    expect(speech.sampleRate).toBe(SPEECH_SAMPLE_RATE);
    expect(speech.samples).toHaveLength(SPEECH_SAMPLE_RATE);
    expect(speech.timing[1]).toEqual({ start: 0.5, end: 1 });
  });

  it("refuses timing that does not match the text", () => {
    expect(() => normalizeSpeech({ samples: new Float32Array(10), sampleRate: 10, timing }, "abc", "acme")).toThrow(
      "acme returned timing for 2 characters, expected 3",
    );
  });
});

describe("decodeGeminiAudio", () => {
  const samples = new Float32Array([0, 0.5, -0.5]);
  it("reads the WAV that Gemini 3 models return", () => {
    const speech = decodeGeminiAudio("audio/wav", toWav({ samples, sampleRate: 24000 }));
    expect(speech.sampleRate).toBe(24000);
    expect(speech.samples).toHaveLength(3);
  });
  it("reads the raw PCM that Gemini 2.5 models return", () => {
    const pcm = toWav({ samples, sampleRate: 24000 }).subarray(44);
    expect(decodeGeminiAudio("audio/L16;codec=pcm;rate=24000", pcm).sampleRate).toBe(24000);
    expect(() => decodeGeminiAudio("audio/mpeg", pcm)).toThrow("unexpected audio");
  });
});
