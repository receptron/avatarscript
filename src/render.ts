// Score + avatar → video. The mesh engine runs in headless Chrome, advanced one frame at a
// time; frames are piped to ffmpeg together with the audio.
import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import { fromWav, frameLevels } from './audio.ts';
import type { Avatar } from './avatar.ts';
import type { Score } from './score.ts';
import { MESH_MOUTH, visemeAt, type MeshMouth } from './visemes.ts';

export interface RenderOptions {
  avatar: Avatar;
  score: Score;
  /** audio file the score refers to */
  audioPath: string;
  out: string;
  fps?: number;
  width?: number;
  height?: number;
  background?: string;
  /** mesh-avatar-studio checkout that provides the engine */
  engineRoot?: string;
  seed?: number;
  /** mouth shapes lead the sound slightly so the smoothed mouth arrives on time, seconds */
  mouthLead?: number;
  onProgress?: (frame: number, total: number) => void;
}

/** One video frame's input to the engine. */
interface FramePlan {
  mouth: MeshMouth | null;
  speaking: boolean;
  level: number;
  actions: (['emotion', string] | ['motion', string])[];
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function findEngineRoot(explicit?: string): Promise<string> {
  const root = resolve(explicit ?? process.env.AVATARSCRIPT_MESH_ENGINE ?? resolve(repoRoot, '../mesh-avatar-studio'));
  const entry = resolve(root, 'src/engine/index.ts');
  if (!await stat(entry).then(() => true, () => false)) {
    throw new Error(`mesh engine not found at ${entry}. Clone mesh-avatar-studio next to this repository, or pass --engine / set AVATARSCRIPT_MESH_ENGINE.`);
  }
  return root;
}

async function bundleEngine(root: string): Promise<string> {
  const result = await build({
    entryPoints: [resolve(root, 'src/engine/index.ts')],
    bundle: true, write: false, format: 'iife', globalName: 'MeshAvatarEngine', target: 'es2022', logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

/** What the engine should do on each frame. */
export function planFrames(score: Score, levels: Float32Array, fps: number, mouthLead: number): FramePlan[] {
  const frames = levels.length;
  const plans: FramePlan[] = [];
  let cue = 0;
  for (let f = 0; f < frames; f++) {
    const t = f / fps;
    const speaking = score.speaking.some(([a, b]) => t >= a && t < b);
    const viseme = visemeAt(score.visemes, t + mouthLead);
    const actions: FramePlan['actions'] = [];
    while (cue < score.cues.length && score.cues[cue].t < t + 0.5 / fps) {
      const c = score.cues[cue++];
      if ('emotion' in c) actions.push(['emotion', c.emotion]);
      else if ('motion' in c) actions.push(['motion', c.motion]);
    }
    plans.push({ mouth: speaking || viseme !== 'sil' ? MESH_MOUTH[viseme] : null, speaking, level: speaking ? levels[f] : 0, actions });
  }
  return plans;
}

export async function render(options: RenderOptions): Promise<void> {
  const { avatar, score, out, fps = 30, width = 1280, height = 720, background = '#e9edf2', seed = 1, mouthLead = 0.04 } = options;
  const unsupported = score.cues.filter(c => 'gaze' in c || 'emphasis' in c);
  if (unsupported.length) console.warn(`note: ${unsupported.length} gaze/emphasis cue(s) are not rendered yet by the mesh runtime`);
  const audio = fromWav(await readFile(options.audioPath));
  const frames = Math.ceil(score.duration * fps);
  const plans = planFrames(score, frameLevels(audio, fps, frames), fps, mouthLead);
  const engine = await bundleEngine(await findEngineRoot(options.engineRoot));

  const browser = await puppeteer.launch({ headless: true });
  const ffmpeg = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-i', options.audioPath, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-c:a', 'aac', '-b:a', '192k',
    '-shortest', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'pipe'] });
  let ffmpegError = '';
  ffmpeg.stderr.on('data', d => { ffmpegError += d; });
  const done = new Promise<void>((res, rej) => {
    ffmpeg.on('error', rej);
    ffmpeg.on('close', code => code === 0 ? res() : rej(new Error(`ffmpeg failed (${code}): ${ffmpegError.trim()}`)));
  });
  done.catch(() => {});   // reported where it is awaited
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    // nothing leaves the machine: the page gets the engine and the avatar inline
    await page.setRequestInterception(true);
    page.on('request', r => /^(data|about|blob):/.test(r.url()) ? r.continue() : r.abort());
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><body style="margin:0;overflow:hidden"><canvas id="avatar" style="display:block;width:${width}px;height:${height}px"></canvas></body></html>`);
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
    }, seed);
    await page.addScriptTag({ content: engine });
    const motions: string[] = await page.evaluate(async (rig, assets, width, height, background) => {
      const w = window as unknown as Record<string, any>;
      const canvas = document.getElementById('avatar') as HTMLCanvasElement;
      const av = await w.MeshAvatarEngine.createMeshAvatar(canvas, { rig, assets, manual: true });
      av.setAutoMotion(false);
      av.setAutoIdle(true);
      av.setEmotion('neutral', { playMotion: false });
      av.advance(1.5, 60);   // let springs and hair settle before the first frame
      const outCanvas = document.createElement('canvas');
      outCanvas.width = width; outCanvas.height = height;
      w.__avatar = { av, canvas, outCanvas, ctx: outCanvas.getContext('2d'), background, lip: false };
      return av.motions.map((m: { id: string }) => m.id);
    }, avatar.rig as never, avatar.assets as never, width, height, background);
    const unknown = [...new Set(score.cues.flatMap(c => 'motion' in c && !motions.includes(c.motion) ? [c.motion] : []))];
    if (unknown.length) throw new Error(`unknown motion(s) for this avatar: ${unknown.join(', ')}. Available: ${motions.join(', ')}`);

    const BATCH = 30;
    for (let f = 0; f < plans.length; f += BATCH) {
      const images: string[] = await page.evaluate((batch: FramePlan[], fps: number) => {
        const s = (window as unknown as Record<string, any>).__avatar;
        const images = [];
        for (const p of batch) {
          for (const [kind, value] of p.actions) {
            if (kind === 'emotion') s.av.setEmotion(value, { playMotion: false });
            else s.av.play(value);
          }
          s.av.setSpeaking(p.speaking);
          s.av.setVoiceLevel(p.level);
          if (p.mouth) { s.av.holdMouth(p.mouth); s.lip = true; }
          else if (s.lip) { s.av.stopLipSync(); s.lip = false; }   // silence: the expression's own mouth
          s.av.advance(1 / fps, fps * 2);
          s.ctx.fillStyle = s.background;
          s.ctx.fillRect(0, 0, s.outCanvas.width, s.outCanvas.height);
          s.ctx.drawImage(s.canvas, 0, 0, s.outCanvas.width, s.outCanvas.height);
          images.push(s.outCanvas.toDataURL('image/jpeg', 0.92).split(',')[1]);
        }
        return images;
      }, plans.slice(f, f + BATCH) as never, fps);
      if (errors.length) throw new Error(`avatar page error: ${errors.join('\n')}`);
      for (const img of images) {
        if (!ffmpeg.stdin.write(Buffer.from(img, 'base64'))) await new Promise(r => ffmpeg.stdin.once('drain', r));
      }
      options.onProgress?.(Math.min(plans.length, f + BATCH), plans.length);
    }
    ffmpeg.stdin.end();
    await done;
  } catch (error) {
    ffmpeg.stdin.destroy();
    ffmpeg.kill();
    throw error;
  } finally {
    await browser.close();
  }
}
