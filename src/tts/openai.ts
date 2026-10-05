// OpenAI text-to-speech. It returns audio only; timing comes from forced alignment.
// https://platform.openai.com/docs/api-reference/audio/createSpeech
import { z } from "zod";
import { s16leToFloat } from "../audio.ts";
import { check } from "../json.ts";
import { EMOTIONS, type Emotion } from "../script.ts";
import type { NativeSpeech, ProviderDefinition, ProviderSettings, SpeechRequest } from "./types.ts";

const SAMPLE_RATE = 24000; // response_format "pcm": 24 kHz 16-bit mono

/** `options` for the openai provider. */
const OptionsSchema = z.strictObject({
  /** emotion → spoken-style instruction (models that take instructions: gpt-4o-mini-tts and later) */
  emotionInstructions: z.partialRecord(z.enum(EMOTIONS), z.string()).optional(),
  /** 0.25–4.0 */
  speed: z.number().min(0.25).max(4).optional(),
});

const DEFAULT_INSTRUCTIONS: Record<Emotion, string> = {
  neutral: "Speak naturally and clearly.",
  happy: "Speak warmly and cheerfully.",
  sad: "Speak softly, with a sad tone.",
  angry: "Speak with an irritated, angry tone.",
  surprised: "Speak with surprise and excitement.",
  relaxed: "Speak in a calm, relaxed way.",
};

function synthesizer(settings: ProviderSettings): (req: SpeechRequest) => Promise<NativeSpeech> {
  const options = check(OptionsSchema, settings.options, "openai options");
  const instructions = { ...DEFAULT_INSTRUCTIONS, ...options.emotionInstructions };
  // tts-1 / tts-1-hd take no instructions
  const takesInstructions = !settings.model.startsWith("tts-1");
  return async (req) => {
    const body: Record<string, unknown> = { model: settings.model, voice: settings.voice, input: req.text, response_format: "pcm" };
    if (takesInstructions) body.instructions = instructions[req.emotion];
    if (options.speed !== undefined) body.speed = options.speed;
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { authorization: `Bearer ${settings.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`OpenAI request failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
    return { samples: s16leToFloat(new Uint8Array(await res.arrayBuffer())), sampleRate: SAMPLE_RATE };
  };
}

export const openAiProvider: ProviderDefinition = {
  apiKeyEnv: "OPENAI_API_KEY",
  defaultModel: "gpt-4o-mini-tts",
  defaultVoice: "coral",
  timing: "aligned",
  create: synthesizer,
};
