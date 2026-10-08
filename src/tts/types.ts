import { z } from "zod";
import type { CharTime } from "../g2p/types.ts";
import type { Emotion } from "../script.ts";

/** How one provider speaks: in createTts()'s config, and per provider in avatar.json's `voice`. */
export const VoiceSettingsShape = {
  /** provider's model; default: the provider's recommended one */
  model: z.string().min(1).optional(),
  /** provider's voice id; default: one of the provider's stock voices */
  voice: z.string().min(1).optional(),
  /** provider-specific options, checked by the provider */
  options: z.record(z.string(), z.unknown()).optional(),
};

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

/** What a provider sends: audio at its own rate, with character timing if it has any. */
export interface NativeSpeech {
  samples: Float32Array;
  sampleRate: number;
  timing?: CharTime[];
}

/**
 * Where a provider's character timing comes from:
 * - "provider": its own, used as is
 * - "provider+refine": its own, corrected against the audio (ElevenLabs v3 can start late)
 * - "aligned": none; forced alignment of the text to the audio
 */
export type TimingSource = "provider" | "provider+refine" | "aligned";

/** How a provider is plugged in. Its output is normalized to `Speech` by createTts(). */
export interface ProviderDefinition {
  /** environment variable holding the API key; absent for a provider that needs none */
  apiKeyEnv?: string;
  defaultModel: string;
  defaultVoice: string;
  timing: TimingSource;
  create(settings: ProviderSettings): (request: SpeechRequest) => Promise<NativeSpeech>;
}
