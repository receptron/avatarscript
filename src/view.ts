// The picture around the avatar: what is behind it, and where the avatar sits and how big it is.
// Set in the script's front matter (background: …, avatar-x: …), overridden by render options.
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { isDecimal } from "./subtitles.ts";

/** A share of the video size, possibly negative (an avatar can stand partly outside the frame). */
const Percent = z.string().refine((s) => s.endsWith("%") && isDecimal(s.slice(0, -1).replace(/^-/, "")), 'a percentage like "50%"');

export const ViewSchema = z.strictObject({
  /** a CSS colour ("transparent" or one with alpha for a see-through video), or an image file */
  background: z.string().min(1).default("#e9edf2"),
  /** horizontal centre of the avatar, as a share of the video width */
  avatarX: Percent.default("50%"),
  /** bottom edge of the avatar, as a share of the video height */
  avatarY: Percent.default("100%"),
  /** height of the avatar, as a share of the video height */
  avatarScale: Percent.default("100%"),
});
export type View = z.output<typeof ViewSchema>;
export type ViewInput = z.input<typeof ViewSchema>;

const FRONT_MATTER: Record<string, keyof ViewInput> = {
  background: "background",
  "avatar-x": "avatarX",
  "avatar-y": "avatarY",
  "avatar-scale": "avatarScale",
};

const IMAGE = /\.(png|jpe?g|webp)$/i;
/** Whether a background names an image file rather than a colour. */
export const isImageBackground = (background: string) => IMAGE.test(background);

/** The view from a script's front matter; an image background is resolved against `baseDir`. */
export function viewFromFrontMatter(meta: Record<string, string>, baseDir: string): View {
  const view: Record<string, string> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (key.startsWith("avatar-") && !Object.hasOwn(FRONT_MATTER, key))
      throw new Error(`unknown front matter key "${key}" (use avatar-x, avatar-y, avatar-scale)`);
    if (Object.hasOwn(FRONT_MATTER, key)) view[FRONT_MATTER[key]] = value;
  }
  if (view.background && isImageBackground(view.background) && !isAbsolute(view.background)) view.background = resolve(baseDir, view.background);
  const result = ViewSchema.safeParse(view);
  if (!result.success) throw new Error(`view: ${z.prettifyError(result.error)}`);
  return result.data;
}

/** `base` with the fields of `override` changed. */
export function resolveView(base: View | undefined, override?: ViewInput): View {
  const result = ViewSchema.safeParse({ ...base, ...override });
  if (!result.success) throw new Error(`view: ${z.prettifyError(result.error)}`);
  return result.data;
}
