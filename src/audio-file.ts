// Reading any audio file ffmpeg understands (MP3, WAV, M4A, …) as mono samples.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fromWav, type Pcm } from "./audio.ts";

/** Mono samples of an audio file at `sampleRate`. A 16-bit mono WAV is read directly. */
export async function readAudio(path: string, sampleRate = 24000): Promise<Pcm> {
  if (path.toLowerCase().endsWith(".wav")) {
    try {
      const wav = fromWav(await readFile(path));
      if (wav.sampleRate === sampleRate) return wav;
    } catch {
      // not 16-bit mono at the expected rate: let ffmpeg convert it
    }
  }
  const ffmpeg = spawn("ffmpeg", ["-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", String(sampleRate), "-"], { stdio: ["ignore", "pipe", "pipe"] });
  const chunks: Buffer[] = [];
  let stderr = "";
  ffmpeg.stdout.on("data", (d: Buffer) => chunks.push(d));
  ffmpeg.stderr.on("data", (d: Buffer) => {
    stderr += d.toString();
  });
  const code = await new Promise<number | null>((res, rej) => {
    ffmpeg.on("error", rej);
    ffmpeg.on("close", res);
  });
  if (code !== 0) throw new Error(`could not read ${path}: ${stderr.trim() || "ffmpeg exited with " + String(code)}`);
  const raw = Buffer.concat(chunks);
  return { samples: new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)), sampleRate };
}
