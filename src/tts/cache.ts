// Caches what a provider sent (audio, and its own timing if any) on disk, keyed by everything
// that changes it, so editing motions or one sentence does not request the whole script again.
// Timing is worked out after the cache, so improving it needs no new requests.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { errorCode, parseJson } from "../json.ts";
import type { NativeSpeech, SpeechRequest } from "./types.ts";

/** A cache file: the native speech with its samples as base64 float32 (plus the request, for people). */
const EntrySchema = z.object({
  samples: z.string(),
  sampleRate: z.number(),
  timing: z.array(z.object({ start: z.number(), end: z.number() })).optional(),
});

async function readEntry(file: string): Promise<NativeSpeech | null> {
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

export type NativeSynthesis = (request: SpeechRequest, options?: { fresh?: boolean }) => Promise<NativeSpeech>;

/**
 * A provider's synthesis with a disk cache in front. `identity` is everything besides the request
 * that changes the audio (provider, model, voice, options) — not the API key. `fresh` skips a
 * cached entry and replaces it.
 */
export function cachedSynthesis(
  synthesize: (request: SpeechRequest) => Promise<NativeSpeech>,
  dir: string,
  identity: Record<string, unknown>,
): NativeSynthesis {
  return async (request, { fresh = false } = {}) => {
    const key = createHash("sha256")
      .update(JSON.stringify({ ...identity, request }))
      .digest("hex")
      .slice(0, 32);
    const file = join(dir, `${key}.json`);
    const hit = fresh ? null : await readEntry(file);
    if (hit) return hit;
    const speech = await synthesize(request);
    await mkdir(dir, { recursive: true });
    const samples = Buffer.from(speech.samples.buffer, speech.samples.byteOffset, speech.samples.byteLength).toString("base64");
    await writeFile(file, JSON.stringify({ ...speech, samples, request }));
    return speech;
  };
}
