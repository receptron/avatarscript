// The browser entry: what a page needs to make an avatar perform a score live, following a clock
// (an audio element's time), instead of rendering a video of it. The page creates the avatar with
// the mesh engine (the mesh-avatar package's createMeshAvatar, with `manual: true`) and hands it
// here. No Node built-in is reached from this module.
import { cueActions, LEVEL_FPS, momentAt, type MeshAvatarApi } from "./perform.ts";
import type { Score } from "./score.ts";

export { cueActions, LEVEL_FPS, momentAt, MOUTH_LEAD } from "./perform.ts";
export type { Action, MeshAvatarApi, Moment } from "./perform.ts";
export { avatarAspect, avatarRect, captionCss } from "./stage.ts";
export type { Rect } from "./stage.ts";
export { resolveSubtitles } from "./subtitles.ts";
export type { SubtitleStyle } from "./subtitles.ts";

export interface PerformerOptions {
  /** what the avatar does and when: a score's mouth shapes, speaking spans and cues */
  score: Pick<Score, "visemes" | "speaking" | "cues">;
  /** the voice level of each frame at `levelFps`, 0–1 (what moves the head with the voice) */
  levels: ArrayLike<number>;
  /** default LEVEL_FPS */
  levelFps?: number;
}

export interface Performer {
  /**
   * Shows the avatar at `t` seconds of the score, `elapsed` seconds after the last call. While
   * `playing`, the mouth, the voice and the cues follow `t`; otherwise the avatar only idles
   * (it blinks and breathes with a closed mouth).
   */
  update(t: number, elapsed: number, playing: boolean): void;
}

/** A jump in time larger than this is a seek: cues passed over are not played one after another. */
const SEEK = 0.5;
/** The most time one call gives the engine (a tab that was in the background reports seconds). */
const MAX_STEP = 0.1;
/** Physics steps per second while advancing, as the renderer uses at 30 fps. */
const PHYSICS_FPS = 60;

/** The emotion in force once the first `count` cues have been given: the last emotion among them. */
function emotionAfter(cues: Score["cues"], count: number): string {
  let emotion = "neutral";
  for (const cue of cues.slice(0, count)) if ("emotion" in cue) emotion = cue.emotion;
  return emotion;
}

/** How many cues come before `t` seconds. */
function cuesBefore(cues: Score["cues"], t: number): number {
  const index = cues.findIndex((cue) => cue.t >= t);
  return index < 0 ? cues.length : index;
}

/**
 * Makes `avatar` perform a score. The avatar is set up as the renderer sets it up (its own idle
 * motion, no motions by itself, settled before the first frame), so a live performance and a video
 * of the same score move alike, but for the engine's own randomness (blinks, glances).
 */
export function createPerformer(avatar: MeshAvatarApi, options: PerformerOptions): Performer {
  const { score, levels, levelFps = LEVEL_FPS } = options;
  const motions = new Set(avatar.motions.map((motion) => motion.id));
  let last = 0;
  let cue = 0;
  let lip = false;
  /** Time not yet given to the engine: it advances by whole physics steps only. */
  let owed = 0;
  /** The last call was while playing. */
  let wasPlaying = false;
  avatar.setAutoMotion(false);
  avatar.setAutoIdle(true);
  // Before the first frame: the emotion the score starts with (a cue at 0), as it will be once playing.
  avatar.setEmotion(emotionAfter(score.cues, cuesBefore(score.cues, Number.EPSILON)), { playMotion: false });
  avatar.advance(1.5, PHYSICS_FPS); // let springs and hair settle before the first frame

  /** After a seek: the cues from there on, and the emotion the ones before leave in force. */
  const seek = (t: number): void => {
    cue = cuesBefore(score.cues, t);
    avatar.setEmotion(emotionAfter(score.cues, cue), { playMotion: false });
  };

  const perform = (t: number): void => {
    if (Math.abs(t - last) > SEEK || t < last) seek(t);
    // The engine lets an emotion go a moment after the avatar stops speaking, as it does while
    // paused: playing again, the emotion in force is the one the cues given so far left (a cue is
    // given a little before its time, so this is by cues, not by the time), and no motion replays.
    else if (!wasPlaying) avatar.setEmotion(emotionAfter(score.cues, cue), { playMotion: false });
    const { actions, next } = cueActions(score.cues, cue, t + MAX_STEP / 2);
    cue = next;
    for (const [kind, value] of actions) {
      if (kind === "emotion") avatar.setEmotion(value, { playMotion: false });
      // A motion this avatar does not have is left out: the video refuses it, a live card should still play.
      else if (motions.has(value)) avatar.play(value);
    }
    const moment = momentAt(score, levels, levelFps, t);
    avatar.setSpeaking(moment.speaking);
    avatar.setVoiceLevel(moment.level);
    if (moment.mouth !== null) avatar.holdMouth(moment.mouth);
    else if (lip) avatar.stopLipSync(); // silence: the expression's own mouth
    lip = moment.mouth !== null;
    last = t;
  };

  const idle = (): void => {
    avatar.setSpeaking(false);
    avatar.setVoiceLevel(0);
    if (lip) avatar.stopLipSync();
    lip = false;
  };

  return {
    update(t, elapsed, playing) {
      if (playing) perform(t);
      else idle();
      wasPlaying = playing;
      // The engine advances by whole physics steps (it rounds seconds × fps), so a display faster
      // than twice the physics rate would advance it by nothing on every frame. What a call leaves
      // over is kept for the next.
      owed += Math.min(MAX_STEP, Math.max(0, elapsed));
      const steps = Math.floor(owed * PHYSICS_FPS + 1e-9);
      if (steps === 0) return;
      avatar.advance(steps / PHYSICS_FPS, PHYSICS_FPS);
      owed -= steps / PHYSICS_FPS;
    },
  };
}
