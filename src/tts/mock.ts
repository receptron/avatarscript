// Offline stand-in for a TTS provider: a buzzing "voice" with exact, made-up character timing.
// It exercises the whole pipeline without an API key; it does not sound like speech.
import type { CharTime } from '../g2p/types.ts';
import type { Synthesis, SynthesisRequest, TtsAdapter } from './types.ts';

const SAMPLE_RATE = 24000;

function charDuration(c: string): number {
  if (/\s/u.test(c)) return 0.05;
  if (/[\p{P}\p{S}]/u.test(c)) return 0.25;
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]/u.test(c)) return 0.13;
  return 0.065;
}

export function mockTts(): TtsAdapter {
  return {
    id: 'mock',
    cacheKey: { provider: 'mock', version: 1 },
    async synthesize(req: SynthesisRequest): Promise<Synthesis> {
      const chars = Array.from(req.text);
      const timing: CharTime[] = [];
      let t = 0.05;
      for (const c of chars) { const d = charDuration(c); timing.push({ start: t, end: t + d }); t += d; }
      const samples = new Float32Array(Math.ceil((t + 0.1) * SAMPLE_RATE));
      chars.forEach((c, i) => {
        if (/[\s\p{P}\p{S}]/u.test(c)) return;
        const a = Math.floor(timing[i].start * SAMPLE_RATE), b = Math.floor(timing[i].end * SAMPLE_RATE);
        for (let k = a; k < b; k++) {
          const x = (k - a) / (b - a);
          const env = Math.sin(Math.PI * x) ** 0.5;
          const phase = (k * 160 / SAMPLE_RATE) % 1;
          samples[k] = env * 0.3 * (phase * 2 - 1);
        }
      });
      return { samples, sampleRate: SAMPLE_RATE, timing };
    },
  };
}
