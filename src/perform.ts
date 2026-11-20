// What the avatar does at each moment of a score. Shared by the renderer (once per video frame, in
// headless Chrome) and the live player (once per animation frame, in the user's browser), so a
// video and a live performance move alike. No Node built-in: it runs in a browser.
import type { Score, ScoreCue } from "./score.ts";
import { MESH_MOUTH, visemeAt, type MeshMouth } from "./visemes.ts";

/** The part of the mesh engine's avatar API that is driven (the mesh-avatar package's MeshAvatar). */
export interface MeshAvatarApi {
  readonly motions: { id: string }[];
  setEmotion(tag: string, options: { playMotion: boolean }): void;
  play(id: string): void;
  setSpeaking(on: boolean): void;
  setVoiceLevel(level: number): void;
  holdMouth(vowel: MeshMouth): void;
  stopLipSync(): void;
  setAutoMotion(on: boolean): void;
  setAutoIdle(on: boolean): void;
  advance(seconds: number, fps: number): void;
}

/** Mouth shapes lead the sound by this much, so the smoothed mouth arrives on time, seconds. */
export const MOUTH_LEAD = 0.04;
/** The rate of the voice levels a live performance carries: one per video frame at this rate. */
export const LEVEL_FPS = 30;

/** The mouth and the voice at one moment. */
export interface Moment {
  /** the mouth shape to hold, or null: the expression's own mouth */
  mouth: MeshMouth | null;
  speaking: boolean;
  /** how loud the voice is, 0–1; 0 while not speaking */
  level: number;
}

/** The moment at `t` seconds: `levels` has the voice level of each frame at `levelFps`. */
export function momentAt(score: Pick<Score, "speaking" | "visemes">, levels: ArrayLike<number>, levelFps: number, t: number, mouthLead = MOUTH_LEAD): Moment {
  const speaking = score.speaking.some(([a, b]) => t >= a && t < b);
  const viseme = visemeAt(score.visemes, t + mouthLead);
  return { mouth: speaking || viseme !== "sil" ? MESH_MOUTH[viseme] : null, speaking, level: speaking ? (levels[Math.round(t * levelFps)] ?? 0) : 0 };
}

/** Something the avatar is told once, at a cue: an emotion from then on, or a motion to play. */
export type Action = ["emotion", string] | ["motion", string];

/** The emotion and motion cues from index `from` that come before `until` seconds, and the index after them. */
export function cueActions(cues: readonly ScoreCue[], from: number, until: number): { actions: Action[]; next: number } {
  const actions: Action[] = [];
  let next = from;
  while (next < cues.length && cues[next].t < until) {
    const cue = cues[next++];
    if ("emotion" in cue) actions.push(["emotion", cue.emotion]);
    else if ("motion" in cue) actions.push(["motion", cue.motion]);
  }
  return { actions, next };
}
