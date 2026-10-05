// ffmpeg: image frames on stdin plus the audio → the video file. The container follows the output
// extension; a see-through background needs one that keeps alpha.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { extname } from "node:path";

export interface Encoder {
  write(frame: Buffer): Promise<void>;
  finish(): Promise<void>;
  abort(): void;
}

/** Video and audio codec arguments for the output file, or an explanation of why it cannot hold the video. */
export function outputCodecs(out: string, alpha: boolean): string[] {
  const ext = extname(out).toLowerCase();
  if (ext === ".webm") return ["-c:v", "libvpx-vp9", "-pix_fmt", alpha ? "yuva420p" : "yuv420p", "-b:v", "0", "-crf", "30", "-c:a", "libopus", "-b:a", "128k"];
  if (ext === ".mov") return ["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", alpha ? "yuva444p10le" : "yuv444p10le", "-c:a", "aac", "-b:a", "192k"];
  if (ext !== ".mp4") throw new Error(`cannot write ${ext || "a file without extension"}: use .mp4, .webm or .mov`);
  if (alpha) throw new Error("an MP4 (H.264) video cannot be transparent: write .webm (VP9) or .mov (ProRes 4444) for a see-through background");
  return ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"];
}

/** ffmpeg reading JPEG (opaque) or PNG (with alpha) frames on stdin. */
export function startEncoder(out: string, audioPath: string, fps: number, alpha: boolean): Encoder {
  const input = ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", alpha ? "png" : "mjpeg", "-i", "-", "-i", audioPath];
  const ffmpeg = spawn("ffmpeg", [...input, ...outputCodecs(out, alpha), "-shortest", out], { stdio: ["pipe", "inherit", "pipe"] });
  let stderr = "";
  ffmpeg.stderr.on("data", (d: Buffer) => {
    stderr += d.toString();
  });
  const done = new Promise<void>((res, rej) => {
    ffmpeg.on("error", rej);
    ffmpeg.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg failed (${code}): ${stderr.trim()}`))));
  });
  done.catch(() => undefined); // reported where it is awaited
  // a write into an ffmpeg that has gone (missing, or exited on an unwritable output) fails the
  // pipe; that surfaces through `done`, which carries ffmpeg's own message
  ffmpeg.stdin.on("error", () => undefined);
  const exited = done.then(() => {
    throw new Error("ffmpeg exited before all frames were written");
  });
  exited.catch(() => undefined);
  return {
    async write(frame) {
      // waiting for "drain" alone would wait forever once ffmpeg is gone
      if (!ffmpeg.stdin.write(frame)) await Promise.race([once(ffmpeg.stdin, "drain"), exited]);
    },
    finish() {
      ffmpeg.stdin.end();
      return done;
    },
    abort() {
      ffmpeg.stdin.destroy();
      ffmpeg.kill();
    },
  };
}
