// The render page: the mesh engine draws the avatar into its own canvas, and each frame is
// composited from the background, the avatar at its place and size, and the caption.
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { Browser, Page } from "puppeteer";
import { z } from "zod";
import type { Avatar } from "./avatar.ts";
import { check } from "./json.ts";
import { isImageBackground, type View } from "./view.ts";
import type { MeshMouth } from "./visemes.ts";

/** One video frame's input to the engine. */
export interface FramePlan {
  mouth: MeshMouth | null;
  speaking: boolean;
  level: number;
  actions: (["emotion", string] | ["motion", string])[];
  /** subtitle text to draw, when subtitles are on */
  caption: string | null;
}

/** The part of the mesh engine's avatar API the renderer drives (mesh-avatar-studio src/engine/index.ts). */
interface MeshAvatarApi {
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

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the render page keeps between batches. */
interface PageState {
  av: MeshAvatarApi;
  canvas: HTMLCanvasElement;
  outCanvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** the background, drawn once */
  backdrop: HTMLCanvasElement;
  avatarRect: Rect;
  format: "image/jpeg" | "image/png";
  /** a mouth shape is being held */
  lip: boolean;
}

declare global {
  interface Window {
    /** set by the bundled engine script */
    MeshAvatarEngine?: {
      createMeshAvatar(canvas: HTMLCanvasElement, options: { rig: unknown; assets: Record<string, string>; manual: boolean }): Promise<MeshAvatarApi>;
    };
    avatarscript?: PageState;
  }
}

export interface PageOptions {
  avatar: Avatar;
  engine: string;
  width: number;
  height: number;
  view: View;
  seed: number;
}

// the engine fits the image into its canvas with these margins (mesh-avatar-studio renderer.js)
const RigViewSchema = z.looseObject({
  image: z.object({ width: z.number(), height: z.number() }),
  view: z.object({ padTop: z.number().optional(), padSide: z.number().optional() }).optional(),
});

/** Width ÷ height of the avatar's picture as the engine draws it (its image and margins). */
export function avatarAspect(rig: unknown): number {
  const r = check(RigViewSchema, rig, "rig");
  return (r.image.width * (1 + 2 * (r.view?.padSide ?? 0))) / (r.image.height * (1 + (r.view?.padTop ?? 0)));
}

/** Where the avatar goes in the frame: its canvas is shaped like the engine's picture, so nothing is cropped. */
export function avatarRect(rig: unknown, width: number, height: number, view: View): Rect {
  const aspect = avatarAspect(rig);
  const h = Math.round((height * parseFloat(view.avatarScale)) / 100);
  const w = Math.round(h * aspect);
  return { x: Math.round((width * parseFloat(view.avatarX)) / 100 - w / 2), y: Math.round((height * parseFloat(view.avatarY)) / 100 - h), w, h };
}

const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

async function backgroundSource(background: string): Promise<{ image: string | null; color: string }> {
  if (!isImageBackground(background)) return { image: null, color: background };
  const type = IMAGE_TYPES[extname(background).toLowerCase()];
  return { image: `data:${type};base64,${(await readFile(background)).toString("base64")}`, color: "transparent" };
}

/** A page with the engine and the avatar loaded and settled. `opaque` is false when the background lets anything through. */
export async function openAvatarPage(browser: Browser, o: PageOptions): Promise<{ page: Page; motions: string[]; errors: string[]; opaque: boolean }> {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e instanceof Error ? e.message : String(e)));
  // nothing leaves the machine: the page gets the engine, the avatar and the background inline
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    (/^(data|about|blob):/.test(r.url()) ? r.continue() : r.abort()).catch(() => undefined);
  });
  const rect = avatarRect(o.avatar.rig, o.width, o.height, o.view);
  await page.setViewport({ width: o.width, height: o.height, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;overflow:hidden"><canvas id="avatar" style="display:block;width:${rect.w}px;height:${rect.h}px"></canvas></body></html>`,
  );
  await page.evaluate((s: number) => {
    // seeded Math.random (mulberry32): blinks, glances and idle motions repeat exactly
    let a = s >>> 0;
    Math.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }, o.seed);
  await page.addScriptTag({ content: o.engine });
  const result = await page.evaluate(setUpPage, o.avatar.rig, o.avatar.assets, {
    width: o.width,
    height: o.height,
    rect,
    ...(await backgroundSource(o.view.background)),
  });
  return { page, errors, ...result };
}

/** Runs in the page: creates the avatar, the output canvas and the backdrop. */
async function setUpPage(
  rig: unknown,
  assets: Record<string, string>,
  o: { width: number; height: number; rect: Rect; image: string | null; color: string },
): Promise<{ motions: string[]; opaque: boolean }> {
  const canvas = document.getElementById("avatar");
  const make = () => Object.assign(document.createElement("canvas"), { width: o.width, height: o.height });
  const outCanvas = make(),
    backdrop = make();
  const ctx = outCanvas.getContext("2d");
  const bctx = backdrop.getContext("2d");
  const engine = window.MeshAvatarEngine;
  if (!(canvas instanceof HTMLCanvasElement) || !ctx || !bctx || !engine) throw new Error("render page did not load");
  bctx.fillStyle = o.color;
  bctx.fillRect(0, 0, o.width, o.height);
  if (o.image) {
    const img = new Image();
    img.src = o.image;
    await img.decode();
    // cover the frame, centred
    const k = Math.max(o.width / img.naturalWidth, o.height / img.naturalHeight);
    bctx.drawImage(img, (o.width - img.naturalWidth * k) / 2, (o.height - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
  }
  const pixels = bctx.getImageData(0, 0, o.width, o.height).data;
  let opaque = true;
  for (let i = 3; i < pixels.length && opaque; i += 4) opaque = pixels[i] === 255;
  const av = await engine.createMeshAvatar(canvas, { rig, assets, manual: true });
  av.setAutoMotion(false);
  av.setAutoIdle(true);
  av.setEmotion("neutral", { playMotion: false });
  av.advance(1.5, 60); // let springs and hair settle before the first frame
  window.avatarscript = { av, canvas, outCanvas, ctx, backdrop, avatarRect: o.rect, format: opaque ? "image/jpeg" : "image/png", lip: false };
  return { motions: av.motions.map((m) => m.id), opaque };
}

/** Drives the engine through a batch of frames; returns them as base64 JPEG or PNG. */
export function renderBatch(page: Page, batch: FramePlan[], fps: number): Promise<string[]> {
  return page.evaluate(
    (frames: FramePlan[], fps: number) => {
      const s = window.avatarscript;
      if (!s) throw new Error("render page is not set up");
      const { x, y, w, h } = s.avatarRect;
      return frames.map((p) => {
        for (const [kind, value] of p.actions) {
          if (kind === "emotion") s.av.setEmotion(value, { playMotion: false });
          else s.av.play(value);
        }
        s.av.setSpeaking(p.speaking);
        s.av.setVoiceLevel(p.level);
        if (p.mouth) s.av.holdMouth(p.mouth);
        else if (s.lip) s.av.stopLipSync(); // silence: the expression's own mouth
        s.lip = p.mouth !== null;
        s.av.advance(1 / fps, fps * 2);
        s.ctx.clearRect(0, 0, s.outCanvas.width, s.outCanvas.height);
        s.ctx.drawImage(s.backdrop, 0, 0);
        s.ctx.drawImage(s.canvas, x, y, w, h);
        if (p.caption) window.avatarscriptCaption?.(s.ctx, p.caption);
        return s.outCanvas.toDataURL(s.format, 0.92).split(",")[1];
      });
    },
    batch,
    fps,
  );
}
