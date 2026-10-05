// Drawing subtitles on the render page. Node resolves the style into pixels (and reads a font file
// if one is named); the page draws each frame's caption onto the composited frame.
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { Page } from "puppeteer";
import type { SubtitleStyle } from "./subtitles.ts";

/** The style in pixels for one video size, ready for the page. */
export interface PageSubtitles {
  /** CSS font family list */
  family: string;
  /** a font file as a data URL, loaded into the page under `family` */
  fontData: string | null;
  size: number;
  weight: string;
  color: string;
  outline: string;
  background: string;
  position: SubtitleStyle["position"];
  margin: number;
  maxWidth: number;
}

declare global {
  interface Window {
    /** draws one caption onto the frame; installed by installSubtitles() */
    avatarscriptCaption?: (ctx: CanvasRenderingContext2D, text: string) => void;
    /** breaks a caption into lines for the current font */
    avatarscriptWrap?: (ctx: CanvasRenderingContext2D, text: string) => string[];
  }
}

const FONT_TYPES: Record<string, string> = { ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2" };

const pixels = (length: string, of: number) => (length.endsWith("%") ? (of * parseFloat(length)) / 100 : parseFloat(length));

export async function pageSubtitles(style: SubtitleStyle, width: number, height: number): Promise<PageSubtitles> {
  const type = FONT_TYPES[extname(style.font).toLowerCase()];
  const fontData = type ? `data:${type};base64,${(await readFile(style.font)).toString("base64")}` : null;
  return {
    family: fontData ? '"AvatarScriptSubtitle"' : style.font,
    fontData,
    size: pixels(style.size, height),
    weight: style.weight,
    color: style.color,
    outline: style.outline,
    background: style.background,
    position: style.position,
    margin: pixels(style.margin, height),
    maxWidth: pixels(style.maxWidth, width),
  };
}

/** Loads the font and installs window.avatarscriptCaption in the page. */
export async function installSubtitles(page: Page, sub: PageSubtitles): Promise<void> {
  await page.evaluate(installWrap, sub.maxWidth);
  await page.evaluate(installDraw, sub);
}

/** Runs in the page: window.avatarscriptWrap, line breaking with lines of even length. */
function installWrap(maxWidth: number) {
  // CJK breaks between any two characters, other text between words; closing punctuation never starts a line
  const UNITS =
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々、。！？「」『』（）]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々、。！？「」『』（）]+\s*|\s+/gu;
  const CLOSING = /^[、。！？」』）,.!?]/u;
  const greedy = (ctx: CanvasRenderingContext2D, text: string, width: number): string[] => {
    const lines: string[] = [];
    let line = "";
    for (const unit of text.match(UNITS) ?? []) {
      const fits = ctx.measureText((line + unit).trimEnd()).width <= width;
      if (fits || !line.trim() || CLOSING.test(unit)) line += unit;
      else {
        lines.push(line.trimEnd());
        line = unit.trimStart();
      }
    }
    if (line.trim()) lines.push(line.trimEnd());
    return lines;
  };
  // as many lines as the width needs, with their lengths evened out (no "す。" alone on a line)
  window.avatarscriptWrap = (ctx, text) => {
    const lines = greedy(ctx, text, maxWidth);
    if (lines.length < 2) return lines;
    let lo = 0,
      hi = maxWidth;
    for (let k = 0; k < 12; k++) {
      const mid = (lo + hi) / 2;
      if (greedy(ctx, text, mid).length > lines.length) lo = mid;
      else hi = mid;
    }
    return greedy(ctx, text, hi);
  };
}

/** Runs in the page: loads the font and installs window.avatarscriptCaption. */
async function installDraw(sub: PageSubtitles) {
  if (sub.fontData) document.fonts.add(await new FontFace("AvatarScriptSubtitle", `url(${sub.fontData})`).load());
  const font = `${sub.weight} ${sub.size}px ${sub.family}`;
  await document.fonts.load(font, "あA");
  const wrapped = new Map<string, string[]>();
  window.avatarscriptCaption = (ctx, text) => {
    ctx.save();
    ctx.font = font;
    const lines = wrapped.get(text) ?? window.avatarscriptWrap?.(ctx, text) ?? [text];
    wrapped.set(text, lines);
    const lineHeight = sub.size * 1.3;
    const { width, height } = ctx.canvas;
    const total = lines.length * lineHeight;
    let top = height - sub.margin - total;
    if (sub.position === "top") top = sub.margin;
    else if (sub.position === "middle") top = (height - total) / 2;
    if (sub.background !== "none") {
      const pad = sub.size * 0.35;
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
      ctx.fillStyle = sub.background;
      ctx.fillRect(width / 2 - w / 2 - pad, top - pad / 2, w + pad * 2, total + pad);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    lines.forEach((line, i) => {
      const y = top + lineHeight * (i + 0.5);
      if (sub.outline !== "none") {
        ctx.lineWidth = sub.size * 0.16;
        ctx.strokeStyle = sub.outline;
        ctx.strokeText(line, width / 2, y);
      }
      ctx.fillStyle = sub.color;
      ctx.fillText(line, width / 2, y);
    });
    ctx.restore();
  };
}
