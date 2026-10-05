// Text-to-speech behind one API. The provider is a parameter, and whatever it returns natively is
// normalized to `Speech`, so application code does not change when the provider or model does.
import { z } from "zod";
import { resample } from "../audio.ts";
import { check } from "../json.ts";
import { withCache } from "./cache.ts";
import { elevenLabsProvider } from "./elevenlabs.ts";
import { mockProvider } from "./mock.ts";
import type { ProviderDefinition, Speech, TextToSpeech } from "./types.ts";

export type { Speech, SpeechRequest, TextToSpeech } from "./types.ts";

/** Sample rate of every `Speech`. */
export const SPEECH_SAMPLE_RATE = 24000;

/** Providers with per-character timing. `mock` is an offline buzz for tests, not speech. */
export const TTS_PROVIDERS = ["elevenlabs", "mock"] as const;
export type TtsProvider = (typeof TTS_PROVIDERS)[number];
export const isTtsProvider = (v: string): v is TtsProvider => TTS_PROVIDERS.some((p) => p === v);

// A Record over the provider names: a name without a definition is a type error.
const DEFINITIONS: Record<TtsProvider, ProviderDefinition> = {
  elevenlabs: elevenLabsProvider,
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
  const native = definition.create({ apiKey, model, voice, options });
  const engine: TextToSpeech = {
    provider: c.provider,
    model,
    voice,
    synthesize: async (request) => normalizeSpeech(await native(request), request.text, c.provider),
  };
  return c.cacheDir ? withCache(engine, c.cacheDir, options) : engine;
}
