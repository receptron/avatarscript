import type { Emotion } from "../script.ts";
import type { CharTime } from "../g2p/types.ts";

export interface SynthesisRequest {
  /** text to speak (characters must come back in the timing in the same order) */
  text: string;
  lang: string;
  emotion: Emotion;
  previousText?: string;
  nextText?: string;
}

export interface Synthesis {
  /** mono samples, -1..1 */
  samples: Float32Array;
  sampleRate: number;
  /** one entry per character (code point) of `text`, seconds from the start of `samples` */
  timing: CharTime[];
}

export interface TtsAdapter {
  id: string;
  /** identifies everything that changes the audio, for caching */
  cacheKey: Record<string, unknown>;
  synthesize(request: SynthesisRequest): Promise<Synthesis>;
}
