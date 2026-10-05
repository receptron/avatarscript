import type { CharTime } from "../g2p/types.ts";
import type { Emotion } from "../script.ts";

/** One piece of text to speak. */
export interface SpeechRequest {
  /** text to speak; the timing comes back with one entry per character of it */
  text: string;
  lang: string;
  emotion: Emotion;
  /** neighbouring text, for providers that use it for continuity */
  previousText?: string;
  nextText?: string;
}

/**
 * What every text-to-speech engine returns, whatever the provider sends natively (MP3 or PCM,
 * any sample rate, character or word timing): mono samples at SPEECH_SAMPLE_RATE and one timing
 * entry per character (code point) of the request text, in seconds from the start of `samples`.
 * Switching providers or models does not change this shape.
 */
export interface Speech {
  samples: Float32Array;
  sampleRate: number;
  timing: CharTime[];
}

/** A configured text-to-speech engine, the same for every provider. Made with createTts(). */
export interface TextToSpeech {
  readonly provider: string;
  readonly model: string;
  readonly voice: string;
  synthesize(request: SpeechRequest): Promise<Speech>;
}

/** Everything a provider needs to make speech, resolved by createTts(). */
export interface ProviderSettings {
  apiKey: string;
  model: string;
  voice: string;
  /** provider-specific options, unchecked; the provider validates its own */
  options: Record<string, unknown>;
}

/** How a provider is plugged in. Its output is normalized to `Speech` by createTts(). */
export interface ProviderDefinition {
  /** environment variable holding the API key; absent for a provider that needs none */
  apiKeyEnv?: string;
  defaultModel: string;
  defaultVoice: string;
  create(settings: ProviderSettings): (request: SpeechRequest) => Promise<Speech>;
}
