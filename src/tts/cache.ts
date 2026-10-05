// Caches synthesized segments on disk, keyed by everything that changes the audio, so editing
// motions or one sentence does not request the whole script again.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { errorCode, parseJson } from "../json.ts";
import type { Synthesis, SynthesisRequest, TtsAdapter } from "./types.ts";

/** A cache file: the synthesis with its samples as base64 float32 (plus the request, for people). */
const EntrySchema = z.object({
  samples: z.string(),
  sampleRate: z.number(),
  timing: z.array(z.object({ start: z.number(), end: z.number() })),
});

async function readEntry(file: string): Promise<Synthesis | null> {
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

export function cached(adapter: TtsAdapter, dir: string): TtsAdapter {
  return {
    ...adapter,
    async synthesize(req: SynthesisRequest): Promise<Synthesis> {
      const key = createHash("sha256")
        .update(JSON.stringify({ ...adapter.cacheKey, req }))
        .digest("hex")
        .slice(0, 32);
      const file = join(dir, `${key}.json`);
      const hit = await readEntry(file);
      if (hit) return hit;
      const result = await adapter.synthesize(req);
      await mkdir(dir, { recursive: true });
      const samples = Buffer.from(result.samples.buffer, result.samples.byteOffset, result.samples.byteLength).toString("base64");
      await writeFile(file, JSON.stringify({ ...result, samples, request: req }));
      return result;
    },
  };
}
