// Where the avatar goes in the frame. Shared by the renderer and the live player; no Node built-in.
import { z } from "zod";
import { check } from "./json.ts";
import { DEFAULT_SUBTITLE_FONT, type SubtitleStyle } from "./subtitles.ts";
import type { View } from "./view.ts";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// the engine fits the image into its canvas with these margins (mesh-avatar-studio renderer.js)
const RigViewSchema = z.looseObject({
  image: z.object({ width: z.number(), height: z.number() }),
  view: z.object({ padTop: z.number().optional(), padSide: z.number().optional() }).optional(),
});

/**
 * Width ÷ height of the avatar's picture as the engine draws it: its image and margins. `padTop`
 * overrides the rig's margin above the image (a negative one crops the top of the image).
 */
export function avatarAspect(rig: unknown, padTop?: number): number {
  const r = check(RigViewSchema, rig, "rig");
  return (r.image.width * (1 + 2 * (r.view?.padSide ?? 0))) / (r.image.height * (1 + (padTop ?? r.view?.padTop ?? 0)));
}

/**
 * Where the avatar goes in the frame, and the engine's top margin. A rig may crop the top of its
 * image (a negative padTop) because the illustration's top edge is flat; that is hidden only when
 * the avatar reaches the top of the frame. Placed lower, the crop would cut the head in mid-picture,
 * so the whole image is shown instead, unless `padTop` says otherwise.
 */
export function avatarRect(
  rig: unknown,
  width: number,
  height: number,
  view: Pick<View, "avatarX" | "avatarY" | "avatarScale">,
  padTop?: number,
): Rect & { padTop: number } {
  const h = Math.round((height * parseFloat(view.avatarScale)) / 100);
  const y = Math.round((height * parseFloat(view.avatarY)) / 100 - h);
  const rigPadTop = check(RigViewSchema, rig, "rig").view?.padTop ?? 0;
  const pad = padTop ?? (y > 0 ? Math.max(0, rigPadTop) : rigPadTop);
  const w = Math.round(h * avatarAspect(rig, pad));
  return { x: Math.round((width * parseFloat(view.avatarX)) / 100 - w / 2), y, w, h, padTop: pad };
}

/** A length of a subtitle style ("40px", "40" or "6%" of the height) as a share of the stage's height, in container units. */
function stageLength(length: string, height: number): string {
  const share = length.endsWith("%") ? Number(length.slice(0, -1)) : (Number(length.replace(/px$/, "")) / height) * 100;
  return `${Math.round(share * 100) / 100}cqh`;
}

const FONT_FILE = /\.(ttf|otf|woff2?)$/i;

/**
 * A subtitle style as the CSS of a caption on a live stage: what the renderer draws on each video
 * frame, for an element inside a stage that is a size container (`container-type: size`) with the
 * video's aspect, `height` being the video's. A font file is not loaded in a page: the default
 * font stands in for it.
 */
export function captionCss(style: SubtitleStyle, height: number): Record<string, string> {
  const margin = stageLength(style.margin, height);
  const place: Record<string, string> =
    style.position === "middle" ? { top: "50%", transform: "translate(-50%, -50%)" } : { [style.position]: margin, transform: "translateX(-50%)" };
  return {
    position: "absolute",
    left: "50%",
    ...place,
    width: "max-content",
    maxWidth: `${style.maxWidth.slice(0, -1)}cqw`,
    margin: "0",
    textAlign: "center",
    textWrap: "balance",
    fontFamily: FONT_FILE.test(style.font) ? DEFAULT_SUBTITLE_FONT : style.font,
    fontSize: stageLength(style.size, height),
    fontWeight: style.weight,
    lineHeight: "1.3",
    color: style.color,
    ...(style.outline === "none" ? {} : { WebkitTextStroke: `0.16em ${style.outline}`, paintOrder: "stroke fill" }),
    ...(style.background === "none" ? {} : { background: style.background, padding: "0.15em 0.5em", borderRadius: "0.2em" }),
  };
}
