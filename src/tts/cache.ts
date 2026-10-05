// Caches synthesized speech on disk, keyed by everything that changes it, so editing motions or
// one sentence does not request the whole script again.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { errorCode, parseJson } from "../json.ts";
import type { Speech, SpeechRequest, TextToSpeech } from "./types.ts";

/** A cache file: the speech with its samples as base64 float32 (plus the request, for people). */
const EntrySchema = z.object({
  samples: z.string(),
  sampleRate: z.number(),
  timing: z.array(z.object({ start: z.number(), end: z.number() })),
});

async function readEntry(file: string): Promise<Speech | null> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
  const entry = parseJson(EntrySchema, text, file);
  const raw = Buffer.from(entry.samples, "base64");
  // copy: a pooled Buffer's offset is not always aligned for Float32Array
  return { ...entry, samples: new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)) };
}

/** The engine with a disk cache in front. The API key is not part of the key: it does not change the audio. */
export function withCache(engine: TextToSpeech, dir: string, options: Record<string, unknown>): TextToSpeech {
  return {
    provider: engine.provider,
    model: engine.model,
    voice: engine.voice,
    async synthesize(request: SpeechRequest): Promise<Speech> {
      const identity = { provider: engine.provider, model: engine.model, voice: engine.voice, options, request };
      const key = createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 32);
      const file = join(dir, `${key}.json`);
      const hit = await readEntry(file);
      if (hit) return hit;
      const speech = await engine.synthesize(request);
      await mkdir(dir, { recursive: true });
      const samples = Buffer.from(speech.samples.buffer, speech.samples.byteOffset, speech.samples.byteLength).toString("base64");
      await writeFile(file, JSON.stringify({ ...speech, samples, request }));
      return speech;
    },
  };
}
