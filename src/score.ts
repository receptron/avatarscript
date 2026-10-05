import { z } from "zod";
import { EMOTIONS } from "./script.ts";
import { CaptionSchema, SubtitleStyleSchema } from "./subtitles.ts";
import { ViewSchema } from "./view.ts";
import { VISEMES } from "./visemes.ts";

const seconds = z.number();

export const ScoreCueSchema = z.union([
  z.object({ t: seconds, emotion: z.enum(EMOTIONS) }),
  z.object({ t: seconds, motion: z.string() }),
  z.object({ t: seconds, emphasis: z.literal(true) }),
  z.object({ t: seconds, gaze: z.string() }),
]);

/** Everything the renderer needs, with all times resolved (seconds). */
export const ScoreSchema = z.object({
  format: z.literal("avatarscript-score/1"),
  lang: z.string(),
  /** audio file, relative to the score */
  audio: z.string(),
  duration: seconds,
  /** [start, viseme]: each lasts until the next */
  visemes: z.array(z.tuple([seconds, z.enum(VISEMES)])),
  /** spans in which the avatar is speaking */
  speaking: z.array(z.tuple([seconds, seconds])),
  cues: z.array(ScoreCueSchema),
  /** the spoken text, one entry per sentence, timed by the speech */
  captions: z.array(CaptionSchema).default([]),
  /** drawn over the video when present */
  subtitles: SubtitleStyleSchema.nullable().default(null),
  /** background and avatar placement */
  view: ViewSchema.prefault({}),
  provenance: z.object({ tts: z.record(z.string(), z.unknown()), script: z.string().optional() }),
});

export type ScoreCue = z.infer<typeof ScoreCueSchema>;
export type Score = z.infer<typeof ScoreSchema>;
