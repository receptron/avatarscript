import type { Emotion } from './script.ts';
import type { VisemeEvent } from './visemes.ts';

export type ScoreCue =
  | { t: number; emotion: Emotion }
  | { t: number; motion: string }
  | { t: number; emphasis: true }
  | { t: number; gaze: string };

/** Everything the renderer needs, with all times resolved (seconds). */
export interface Score {
  format: 'avatarscript-score/1';
  lang: string;
  /** audio file, relative to the score */
  audio: string;
  duration: number;
  visemes: VisemeEvent[];
  /** spans in which the avatar is speaking */
  speaking: [start: number, end: number][];
  cues: ScoreCue[];
  provenance: { tts: Record<string, unknown>; script?: string };
}
