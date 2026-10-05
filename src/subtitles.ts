// Subtitles: the spoken text, timed by the speech, drawn over the video when enabled.
// Style comes from the script's front matter (subtitle-font: …), and render options override it.
import { z } from "zod";
import type { CharTime } from "./g2p/types.ts";
import { isSpoken } from "./timing.ts";

/** A non-negative number written with digits and at most one point. */
export const isDecimal = (s: string) => /^[\d.]+$/.test(s) && Number.isFinite(Number(s));
/** A length: pixels ("40" or "40px") or a share of the video height ("6%"). */
const Length = z.string().refine((s) => isDecimal(s.replace(/(px|%)$/, "")), 'a length like "40px" or "6%"');
/** A share of the video width ("90%"). */
const Percent = z.string().refine((s) => s.endsWith("%") && isDecimal(s.slice(0, -1)), 'a percentage like "90%"');

/** Hiragino on macOS, Noto CJK on Linux, Yu Gothic on Windows, then whatever sans-serif there is. */
export const DEFAULT_SUBTITLE_FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans CJK JP", "Noto Sans JP", "Yu Gothic", sans-serif';

export const SubtitleStyleSchema = z.strictObject({
  /** CSS font family list, or a font file (.ttf, .otf, .woff, .woff2) */
  font: z.string().min(1).default(DEFAULT_SUBTITLE_FONT),
  size: Length.default("5.5%"),
  weight: z.enum(["normal", "bold"]).default("bold"),
  /** CSS colours; "none" turns the outline or background off */
  color: z.string().min(1).default("#ffffff"),
  outline: z.string().min(1).default("#000000"),
  background: z.string().min(1).default("none"),
  position: z.enum(["bottom", "top", "middle"]).default("bottom"),
  /** distance from the top or bottom edge */
  margin: Length.default("6%"),
  maxWidth: Percent.default("90%"),
});
export type SubtitleStyle = z.output<typeof SubtitleStyleSchema>;
export type SubtitleStyleInput = z.input<typeof SubtitleStyleSchema>;

export const CaptionSchema = z.object({ start: z.number(), end: z.number(), text: z.string() });
export type Caption = z.infer<typeof CaptionSchema>;

// front matter key → style field
const FRONT_MATTER: Record<string, keyof SubtitleStyleInput> = {
  "subtitle-font": "font",
  "subtitle-size": "size",
  "subtitle-weight": "weight",
  "subtitle-color": "color",
  "subtitle-outline": "outline",
  "subtitle-background": "background",
  "subtitle-position": "position",
  "subtitle-margin": "margin",
  "subtitle-max-width": "maxWidth",
};

/**
 * Subtitle settings from a script's front matter: `subtitles: on|off` and `subtitle-*` keys.
 * Returns null when the script does not turn subtitles on.
 */
export function subtitlesFromFrontMatter(meta: Record<string, string>): SubtitleStyle | null {
  const style: Record<string, string> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (!key.startsWith("subtitle-")) continue;
    if (!Object.hasOwn(FRONT_MATTER, key)) throw new Error(`unknown front matter key "${key}" (use ${Object.keys(FRONT_MATTER).join(", ")})`);
    style[FRONT_MATTER[key]] = value;
  }
  const on = Object.hasOwn(meta, "subtitles") ? meta.subtitles : "off";
  if (!["on", "off", "true", "false"].includes(on)) throw new Error(`subtitles must be on or off, got "${on}"`);
  const result = SubtitleStyleSchema.safeParse(style);
  if (!result.success) throw new Error(`subtitle style: ${z.prettifyError(result.error)}`);
  return on === "on" || on === "true" ? result.data : null;
}

/** How long a caption stays after its last word, when nothing follows soon. */
const HOLD = 0.4;

/** Whether chars[i] ends a sentence: 。！？ always; . ! ? only before a space or the end ("3.5" does not). */
function endsSentence(chars: string[], i: number): boolean {
  const c = chars[i];
  if (!/[。！？!?.]/u.test(c)) return false;
  if (i + 1 === chars.length) return true;
  const next = chars[i + 1];
  if (/[。！？!?.」』)]/u.test(next)) return false; // "！？", "…。」": end after the run
  return /[。！？]/u.test(c) || /\s/u.test(next);
}

/** Captions for one spoken segment: one per sentence, from its first spoken character to its last plus a hold. */
export function segmentCaptions(text: string, times: CharTime[]): Caption[] {
  const chars = Array.from(text);
  const captions: Caption[] = [];
  let from = 0;
  chars.forEach((_, i) => {
    if (i < chars.length - 1 && !endsSentence(chars, i)) return;
    const spoken = times.slice(from, i + 1).filter((_t, k) => isSpoken(chars[from + k]));
    const line = chars
      .slice(from, i + 1)
      .join("")
      .trim()
      .replace(/\s+/gu, " ");
    if (line && spoken.length) captions.push({ start: spoken[0].start, end: (spoken.at(-1)?.end ?? spoken[0].start) + HOLD, text: line });
    from = i + 1;
  });
  return captions;
}

/** Captions in order, each ending no later than the next one starts. */
export function joinCaptions(captions: Caption[]): Caption[] {
  const sorted = [...captions].sort((x, y) => x.start - y.start);
  return sorted.map((c, k) => ({ ...c, end: Math.min(c.end, sorted[k + 1]?.start ?? Infinity) }));
}

/**
 * Subtitles to use: `base` (from the script or the score) with an override applied — false turns
 * them off, true turns them on (with the base style or the defaults), a style object turns them on
 * with those fields changed.
 */
export function resolveSubtitles(base: SubtitleStyle | null | undefined, override?: boolean | SubtitleStyleInput): SubtitleStyle | null {
  if (override === false) return null;
  if (override === undefined) return base ?? null;
  if (override === true) return base ?? SubtitleStyleSchema.parse({});
  const result = SubtitleStyleSchema.safeParse({ ...base, ...override });
  if (!result.success) throw new Error(`subtitle style: ${z.prettifyError(result.error)}`);
  return result.data;
}

/** The caption shown at time t, if any. */
export function captionAt(captions: Caption[], t: number): Caption | undefined {
  return captions.find((c) => t >= c.start && t < c.end);
}
