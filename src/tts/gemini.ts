// Gemini text-to-speech. It returns audio only; timing comes from forced alignment.
// https://ai.google.dev/gemini-api/docs/speech-generation
//
// Without `instructions` or `emotionInstructions` only the text is sent. With them the prompt
// takes MulmoCast's "### DIRECTOR'S NOTES" / "#### TRANSCRIPT" form, which was never read aloud in
// 40 measured requests (34 on gemini-2.5-flash-preview-tts, 6 on gemini-3.8-flash-tts; 2026-10-07).
// Other forms were read aloud on gemini-3.8-flash-tts ("Say cheerfully: …", a bare "TRANSCRIPT:"
// preamble), and systemInstruction is rejected. Speech that still includes the notes is caught by
// the mismatch check in createTts().
import { z } from "zod";
import { fromWav, s16leToFloat } from "../audio.ts";
import { check, parseJson } from "../json.ts";
import { hasStyle, StyleOptionsShape, styleInstruction } from "./style.ts";
import type { NativeSpeech, ProviderDefinition, ProviderSettings, SpeechRequest } from "./types.ts";

/** `options` for the gemini provider. */
const OptionsSchema = z.strictObject(StyleOptionsShape);

/** The prompt: the text alone, or the text after director's notes when there is a style. */
export function geminiPrompt(text: string, notes: string | null): string {
  return notes === null ? text : `### DIRECTOR'S NOTES\n${notes}\n\n#### TRANSCRIPT\n${text}`;
}

/** Overload answers (gemini-3.8-flash-tts returns 503 now and then) are retried after these waits. */
const RETRY_DELAYS_MS = [1000, 2000, 4000];
const RETRY_STATUS = new Set([429, 503]);

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
  const options = check(OptionsSchema, settings.options, "gemini options");
  const styled = hasStyle(options);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.model)}:generateContent`;
  return async (req) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: geminiPrompt(req.text, styled ? styleInstruction(options, req.emotion) : null) }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: settings.voice } } } },
    });
    const post = () => fetch(url, { method: "POST", headers: { "x-goog-api-key": settings.apiKey, "content-type": "application/json" }, body });
    let res = await post();
    for (const delay of RETRY_DELAYS_MS) {
      if (!RETRY_STATUS.has(res.status)) break;
      await res.body?.cancel();
      await new Promise((done) => setTimeout(done, delay));
      res = await post();
    }
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
