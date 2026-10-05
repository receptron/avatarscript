// Gemini text-to-speech. It returns audio only; timing comes from forced alignment.
// https://ai.google.dev/gemini-api/docs/speech-generation
//
// Only the text is sent. Gemini TTS models read a style instruction aloud when it is written into
// the prompt ("Say cheerfully: …", or a "TRANSCRIPT:" preamble — both measured on
// gemini-3.8-flash-tts) and reject systemInstruction, so emotion is shown on the face only.
import { z } from "zod";
import { fromWav, s16leToFloat } from "../audio.ts";
import { parseJson } from "../json.ts";
import type { NativeSpeech, ProviderDefinition, ProviderSettings, SpeechRequest } from "./types.ts";

const ResponseSchema = z.object({
  candidates: z
    .array(z.object({ content: z.object({ parts: z.array(z.object({ inlineData: z.object({ mimeType: z.string(), data: z.string() }).optional() })) }) }))
    .min(1),
});

/** Gemini answers with WAV (3.x) or raw 16-bit PCM labelled "audio/L16;rate=24000" (2.5). */
export function decodeGeminiAudio(mimeType: string, data: Buffer): NativeSpeech {
  if (mimeType.startsWith("audio/wav") || mimeType.startsWith("audio/x-wav")) return fromWav(data);
  const rate = /rate=(\d+)/.exec(mimeType);
  if (!rate) throw new Error(`Gemini returned unexpected audio: ${mimeType}`);
  return { samples: s16leToFloat(data), sampleRate: Number(rate[1]) };
}

function synthesizer(settings: ProviderSettings): (req: SpeechRequest) => Promise<NativeSpeech> {
  return async (req) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.model)}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": settings.apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: req.text }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: settings.voice } } } },
      }),
    });
    if (!res.ok) throw new Error(`Gemini request failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
    const json = parseJson(ResponseSchema, await res.text(), "Gemini response");
    const audio = json.candidates[0].content.parts.find((p) => p.inlineData)?.inlineData;
    if (!audio) throw new Error("Gemini returned no audio");
    return decodeGeminiAudio(audio.mimeType, Buffer.from(audio.data, "base64"));
  };
}

export const geminiProvider: ProviderDefinition = {
  apiKeyEnv: "GEMINI_API_KEY",
  defaultModel: "gemini-3.8-flash-tts",
  defaultVoice: "Kore",
  timing: "aligned",
  create: synthesizer,
};
