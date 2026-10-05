import { afterEach, describe, expect, it, vi } from "vitest";
import { startEncoder } from "../src/render-encoder.ts";

describe("startEncoder", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("rejects frame writes when ffmpeg is not there, instead of waiting forever", async () => {
    vi.stubEnv("PATH", "");
    const encoder = startEncoder("out.mp4", "audio.wav", 30, false);
    const frame = Buffer.alloc(1 << 20);
    const writeAll = async () => {
      for (let i = 0; i < 64; i++) await encoder.write(frame);
    };
    await expect(writeAll()).rejects.toThrow("ENOENT");
  });
});
