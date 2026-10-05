// Caches synthesized segments on disk, keyed by everything that changes the audio, so editing
// motions or one sentence does not request the whole script again.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Synthesis, SynthesisRequest, TtsAdapter } from './types.ts';

export function cached(adapter: TtsAdapter, dir: string): TtsAdapter {
  return {
    ...adapter,
    async synthesize(req: SynthesisRequest): Promise<Synthesis> {
      const key = createHash('sha256').update(JSON.stringify({ ...adapter.cacheKey, req })).digest('hex').slice(0, 32);
      const file = join(dir, `${key}.json`);
      try {
        const hit = JSON.parse(await readFile(file, 'utf8'));
        const raw = Buffer.from(hit.samples, 'base64');
        // copy: a pooled Buffer's offset is not always aligned for Float32Array
        return { ...hit, samples: new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)) };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const result = await adapter.synthesize(req);
      await mkdir(dir, { recursive: true });
      const samples = Buffer.from(result.samples.buffer, result.samples.byteOffset, result.samples.byteLength).toString('base64');
      await writeFile(file, JSON.stringify({ ...result, samples, request: req }));
      return result;
    },
  };
}
