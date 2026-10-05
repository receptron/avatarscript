// ElevenLabs text-to-speech with per-character timestamps.
// https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps
import { z } from "zod";
import { s16leToFloat } from "../audio.ts";
import { check, parseJson } from "../json.ts";
import { EMOTIONS, type Emotion } from "../script.ts";
import type { NativeSpeech, ProviderDefinition, ProviderSettings, SpeechRequest } from "./types.ts";

/** `options` for the elevenlabs provider. */
const OptionsSchema = z.strictObject({
  /** emotion → v3 audio tag; only used with eleven_v3 models */
  emotionTags: z.partialRecord(z.enum(EMOTIONS), z.string()).optional(),
  /** for repeatable output */
  seed: z.number().int().nonnegative().optional(),
});

const DEFAULT_TAGS: Partial<Record<Emotion, string>> = {
  happy: "[happy]",
  sad: "[sad]",
  angry: "[angry]",
  surprised: "[surprised]",
  relaxed: "[calm]",
};
const SAMPLE_RATE = 24000;

const AlignmentSchema = z.object({
  characters: z.array(z.string()),
  character_start_times_seconds: z.array(z.number()),
  character_end_times_seconds: z.array(z.number()),
});
type Alignment = z.infer<typeof AlignmentSchema>;

/** The parts of the /with-timestamps response that are used. */
const ResponseSchema = z.object({ audio_base64: z.string(), alignment: AlignmentSchema.nullable() });

/** Matches the provider's characters to `text` and returns one timing per code point. */
export function alignToText(text: string, alignment: Alignment, skip: number) {
  const chars = Array.from(text);
  const got = alignment.characters.slice(skip);
  if (got.join("") !== chars.join("")) {
    throw new Error(`ElevenLabs timing does not match the text sent.\n  sent: ${JSON.stringify(text)}\n  got:  ${JSON.stringify(got.join(""))}`);
  }
  // the provider may split a code point differently; walk both by their string length
  const timing: { start: number; end: number }[] = [];
  let k = skip;
  for (const c of chars) {
    const start = alignment.character_start_times_seconds[k];
    let s = "",
      end = start;
    while (s.length < c.length && k < alignment.characters.length) {
      s += alignment.characters[k];
      end = alignment.character_end_times_seconds[k];
      k++;
    }
    timing.push({ start, end });
  }
  return timing;
}

function synthesizer(settings: ProviderSettings): (req: SpeechRequest) => Promise<NativeSpeech> {
  const options = check(OptionsSchema, settings.options, "elevenlabs options");
  const { apiKey, model, voice } = settings;
  const v3 = model.startsWith("eleven_v3");
  const tags = { ...DEFAULT_TAGS, ...options.emotionTags };
  return async (req) => {
    const tag = v3 ? tags[req.emotion] : undefined;
    const prefix = tag ? `${tag} ` : "";
    const body: Record<string, unknown> = { text: prefix + req.text, model_id: model };
    // v3 takes no request stitching; the others read the neighbouring text for continuity
    if (!v3) {
      if (req.previousText) body.previous_text = req.previousText;
      if (req.nextText) body.next_text = req.nextText;
    }
    // without it, kanji can be read as Chinese; eleven_multilingual_v2 does not accept it
    if (model !== "eleven_multilingual_v2") body.language_code = req.lang;
    if (options.seed !== undefined) body.seed = options.seed;
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/with-timestamps?output_format=pcm_${SAMPLE_RATE}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`ElevenLabs request failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
    const json = parseJson(ResponseSchema, await res.text(), "ElevenLabs response");
    if (!json.alignment) throw new Error("ElevenLabs returned no character timing");
    const samples = s16leToFloat(Buffer.from(json.audio_base64, "base64"));
    return { samples, sampleRate: SAMPLE_RATE, timing: alignToText(req.text, json.alignment, Array.from(prefix).length) };
  };
}

export const elevenLabsProvider: ProviderDefinition = {
  apiKeyEnv: "ELEVENLABS_API_KEY",
  defaultModel: "eleven_v3",
  // "Sarah", one of ElevenLabs' premade multilingual voices
  defaultVoice: "EXAVITQu4vr4xnSDxMaL",
  timing: "provider+refine",
  create: synthesizer,
};
