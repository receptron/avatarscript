// ElevenLabs text-to-speech with per-character timestamps.
// https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps
import { s16leToFloat } from '../audio.ts';
import type { Emotion } from '../script.ts';
import type { Synthesis, SynthesisRequest, TtsAdapter } from './types.ts';

export interface ElevenLabsOptions {
  apiKey: string;
  voiceId: string;
  model?: string;
  /** emotion → v3 audio tag; only used with eleven_v3 */
  emotionTags?: Partial<Record<Emotion, string>>;
  seed?: number;
}

const DEFAULT_TAGS: Partial<Record<Emotion, string>> = {
  happy: '[happy]', sad: '[sad]', angry: '[angry]', surprised: '[surprised]', relaxed: '[calm]',
};
const SAMPLE_RATE = 24000;

interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** Matches the provider's characters to `text` and returns one timing per code point. */
export function alignToText(text: string, alignment: Alignment, skip: number) {
  const chars = Array.from(text);
  const got = alignment.characters.slice(skip);
  if (got.join('') !== chars.join('')) {
    throw new Error(`ElevenLabs timing does not match the text sent.\n  sent: ${JSON.stringify(text)}\n  got:  ${JSON.stringify(got.join(''))}`);
  }
  // the provider may split a code point differently; walk both by their string length
  const timing: { start: number; end: number }[] = [];
  let k = skip;
  for (const c of chars) {
    let s = '', start = alignment.character_start_times_seconds[k], end = start;
    while (s.length < c.length && k < alignment.characters.length) {
      s += alignment.characters[k];
      end = alignment.character_end_times_seconds[k];
      k++;
    }
    timing.push({ start, end });
  }
  return timing;
}

export function elevenLabs(options: ElevenLabsOptions): TtsAdapter {
  const model = options.model ?? 'eleven_v3';
  const v3 = model.startsWith('eleven_v3');
  const tags = { ...DEFAULT_TAGS, ...options.emotionTags };
  return {
    id: 'elevenlabs',
    cacheKey: { provider: 'elevenlabs', model, voice: options.voiceId, tags: v3 ? tags : null, seed: options.seed ?? null, rate: SAMPLE_RATE },
    async synthesize(req: SynthesisRequest): Promise<Synthesis> {
      const tag = v3 ? tags[req.emotion] : undefined;
      const prefix = tag ? `${tag} ` : '';
      const body: Record<string, unknown> = { text: prefix + req.text, model_id: model };
      // v3 takes no request stitching; the others read the neighbouring text for continuity
      if (!v3) {
        if (req.previousText) body.previous_text = req.previousText;
        if (req.nextText) body.next_text = req.nextText;
      }
      // without it, kanji can be read as Chinese; eleven_multilingual_v2 does not accept it
      if (model !== 'eleven_multilingual_v2') body.language_code = req.lang;
      if (options.seed !== undefined) body.seed = options.seed;
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(options.voiceId)}/with-timestamps?output_format=pcm_${SAMPLE_RATE}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'xi-api-key': options.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`ElevenLabs request failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
      const json = await res.json() as { audio_base64: string; alignment: Alignment | null };
      if (!json.alignment) throw new Error('ElevenLabs returned no character timing');
      const samples = s16leToFloat(Buffer.from(json.audio_base64, 'base64'));
      return { samples, sampleRate: SAMPLE_RATE, timing: alignToText(req.text, json.alignment, Array.from(prefix).length) };
    },
  };
}
