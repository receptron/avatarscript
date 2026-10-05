// Mono PCM helpers: decoding provider output, stitching segments, writing WAV and measuring
// loudness per video frame.

export interface Pcm {
  samples: Float32Array;
  sampleRate: number;
}

export function s16leToFloat(buf: Uint8Array): Float32Array {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = new Float32Array(Math.floor(buf.byteLength / 2));
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

export function silence(seconds: number, sampleRate: number): Float32Array {
  return new Float32Array(Math.max(0, Math.round(seconds * sampleRate)));
}

export function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function toWav({ samples, sampleRate }: Pcm): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(v < 0 ? v * 32768 : v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Reads a 16-bit mono PCM WAV written by toWav(). */
export function fromWav(buf: Buffer): Pcm {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAV file");
  let at = 12,
    sampleRate = 0,
    channels = 0,
    bits = 0;
  while (at + 8 <= buf.length) {
    const id = buf.toString("ascii", at, at + 4),
      size = buf.readUInt32LE(at + 4);
    if (id === "fmt ") {
      channels = buf.readUInt16LE(at + 10);
      sampleRate = buf.readUInt32LE(at + 12);
      bits = buf.readUInt16LE(at + 22);
    } else if (id === "data") {
      if (channels !== 1 || bits !== 16) throw new Error("only 16-bit mono WAV is supported");
      return { samples: s16leToFloat(buf.subarray(at + 8, at + 8 + size)), sampleRate };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error("WAV file has no data chunk");
}

/** RMS loudness for each video frame, normalised so loud speech is near 1. */
export function frameLevels({ samples, sampleRate }: Pcm, fps: number, frames: number): Float32Array {
  const rms = new Float32Array(frames);
  const hop = sampleRate / fps;
  for (let f = 0; f < frames; f++) {
    const a = Math.floor(f * hop),
      b = Math.min(samples.length, Math.floor((f + 1) * hop));
    let sum = 0;
    for (let i = a; i < b; i++) sum += samples[i] * samples[i];
    rms[f] = b > a ? Math.sqrt(sum / (b - a)) : 0;
  }
  // the 95th percentile, so a single shout does not make everything else quiet
  const sorted = [...rms].filter((v) => v > 0.005).sort((x, y) => x - y);
  const ref = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 1;
  return rms.map((v) => Math.min(1, v / ref));
}
