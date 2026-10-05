// Text-to-speech behind one API. The provider is a parameter, and whatever it returns natively is
// normalized to `Speech`, so application code does not change when the provider or model does.
import { z } from "zod";
import { resample } from "../audio.ts";
import { alignText } from "../align/index.ts";
import type { CharTime } from "../g2p/types.ts";
import { check } from "../json.ts";
import { isSpoken, refineTiming, silences, trimToVoice } from "../timing.ts";
import { cachedSynthesis, type NativeSynthesis } from "./cache.ts";
import { elevenLabsProvider } from "./elevenlabs.ts";
import { geminiProvider } from "./gemini.ts";
import { mockProvider } from "./mock.ts";
import { openAiProvider } from "./openai.ts";
import type { NativeSpeech, ProviderDefinition, Speech, SpeechRequest, TextToSpeech, TimingSource } from "./types.ts";

export type { Speech, SpeechRequest, TextToSpeech } from "./types.ts";

/** Sample rate of every `Speech`. */
export const SPEECH_SAMPLE_RATE = 24000;

/**
 * elevenlabs returns character timing; openai and gemini return audio only and are timed by
 * forced alignment (a 635 MB model downloaded once). `mock` is an offline buzz for tests, not speech.
 */
export const TTS_PROVIDERS = ["elevenlabs", "openai", "gemini", "mock"] as const;
export type TtsProvider = (typeof TTS_PROVIDERS)[number];
export const isTtsProvider = (v: string): v is TtsProvider => TTS_PROVIDERS.some((p) => p === v);

// A Record over the provider names: a name without a definition is a type error.
const DEFINITIONS: Record<TtsProvider, ProviderDefinition> = {
  elevenlabs: elevenLabsProvider,
  openai: openAiProvider,
  gemini: geminiProvider,
  mock: mockProvider,
};

export const TtsConfigSchema = z.strictObject({
  provider: z.enum(TTS_PROVIDERS),
  /** provider's model; default: the provider's recommended one */
  model: z.string().min(1).optional(),
  /** provider's voice id; default: one of the provider's stock voices */
  voice: z.string().min(1).optional(),
  /** default: the provider's environment variable (ELEVENLABS_API_KEY, …) */
  apiKey: z.string().min(1).optional(),
  /** provider-specific options, checked by the provider */
  options: z.record(z.string(), z.unknown()).optional(),
  /** cache synthesized speech here, keyed by everything that changes it */
  cacheDir: z.string().min(1).optional(),
});
export type TtsConfig = z.input<typeof TtsConfigSchema>;

/** Brings a provider's output to the common shape, or says what is wrong with it. */
export function normalizeSpeech(speech: Speech, text: string, provider: string): Speech {
  const expected = Array.from(text).length;
  if (speech.timing.length !== expected) {
    throw new Error(`${provider} returned timing for ${speech.timing.length} characters, expected ${expected}`);
  }
  const samples = resample(speech.samples, speech.sampleRate, SPEECH_SAMPLE_RATE);
  const duration = samples.length / SPEECH_SAMPLE_RATE;
  const clamp = (t: number) => Math.min(duration, Math.max(0, t));
  const timing = speech.timing.map(({ start, end }) => ({ start: clamp(start), end: Math.max(clamp(start), clamp(end)) }));
  return { samples, sampleRate: SPEECH_SAMPLE_RATE, timing };
}

/** Thresholds for audio that does not say the text, measured on instructions read aloud by Gemini. */
const MAX_UNEXPLAINED_VOICE = 0.25; // seconds of voice outside the aligned text
const MAX_MISMATCH = 0.6; // nats per frame between what the model hears and the text

/** Why the aligned audio does not seem to say the text, or null when it does. */
function mismatchReason(text: string, timing: CharTime[], mismatch: number, native: NativeSpeech): string | null {
  const chars = Array.from(text);
  const spoken = timing.filter((_, k) => isSpoken(chars[k]));
  const voice = silences(native.samples, native.sampleRate);
  if (!voice || !spoken.length) return null;
  const outside = Math.max(0, spoken[0].start - voice.onset) + Math.max(0, voice.offset - (spoken.at(-1)?.end ?? 0));
  if (outside > MAX_UNEXPLAINED_VOICE) return `${outside.toFixed(2)} s of speech that is not in the text`;
  if (mismatch > MAX_MISMATCH) return `the speech does not match the text (score ${mismatch.toFixed(2)})`;
  return null;
}

/** Character timing for native speech, by the provider's timing source. */
async function timingFor(source: TimingSource, native: NativeSpeech, text: string): Promise<{ timing: CharTime[]; problem: string | null }> {
  const chars = Array.from(text);
  if (source !== "aligned") {
    if (!native.timing) throw new Error("provider returned no timing");
    const timing = source === "provider+refine" ? refineTiming(chars, native.timing, native.samples, native.sampleRate) : native.timing;
    return { timing, problem: null };
  }
  const aligned = await alignText(text, native.samples, native.sampleRate);
  const timing = trimToVoice(chars, aligned.timing, native.samples, native.sampleRate);
  return { timing, problem: mismatchReason(text, timing, aligned.mismatch, native) };
}

/** A text-to-speech engine for the given provider. */
export function createTts(config: TtsConfig): TextToSpeech {
  const c = check(TtsConfigSchema, config, "text-to-speech config");
  const definition = DEFINITIONS[c.provider];
  const env = definition.apiKeyEnv;
  const apiKey = c.apiKey ?? (env ? process.env[env] : undefined) ?? "";
  if (env && !apiKey) throw new Error(`${c.provider} needs an API key: pass apiKey or set ${env}`);
  const model = c.model ?? definition.defaultModel;
  const voice = c.voice ?? definition.defaultVoice;
  const options = c.options ?? {};
  const create = definition.create({ apiKey, model, voice, options });
  const native: NativeSynthesis = c.cacheDir
    ? cachedSynthesis(create, c.cacheDir, { provider: c.provider, model, voice, options })
    : (request) => create(request);
  // audio that does not say the text (a provider reading extra words) is requested once more
  const synthesize = async (request: SpeechRequest, attempt = 1): Promise<Speech> => {
    const speech = await native(request, { fresh: attempt > 1 });
    const { timing, problem } = await timingFor(definition.timing, speech, request.text);
    if (!problem) return normalizeSpeech({ ...speech, timing }, request.text, c.provider);
    if (attempt < 2) return synthesize(request, attempt + 1);
    throw new Error(`${c.provider} speech for "${request.text}" does not match the text: ${problem}`);
  };
  return { provider: c.provider, model, voice, synthesize: (request) => synthesize(request) };
}
