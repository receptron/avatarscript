import { describe, expect, it } from "vitest";
import { outputCodecs } from "../src/render-encoder.ts";
import { avatarAspect, avatarRect } from "../src/render-page.ts";
import { joinCaptions, resolveSubtitles, segmentCaptions, subtitlesFromFrontMatter } from "../src/subtitles.ts";
import { resolveView, viewFromFrontMatter } from "../src/view.ts";

const even = (n: number, d = 0.1) => Array.from({ length: n }, (_, i) => ({ start: i * d, end: (i + 1) * d }));

describe("subtitles", () => {
  it("are off unless the script turns them on, and take subtitle-* style keys", () => {
    expect(subtitlesFromFrontMatter({ lang: "ja" })).toBeNull();
    const style = subtitlesFromFrontMatter({ subtitles: "on", "subtitle-size": "40px", "subtitle-position": "top" });
    expect(style).toMatchObject({ size: "40px", position: "top", color: "#ffffff", weight: "bold" });
  });

  it("reject unknown keys and bad values", () => {
    expect(() => subtitlesFromFrontMatter({ "subtitle-colour": "red" })).toThrow('unknown front matter key "subtitle-colour"');
    expect(() => subtitlesFromFrontMatter({ subtitles: "on", "subtitle-size": "big" })).toThrow("subtitle style");
    expect(() => subtitlesFromFrontMatter({ subtitles: "yes" })).toThrow("subtitles must be on or off");
  });

  it("can be turned on, off or restyled over the script", () => {
    const base = subtitlesFromFrontMatter({ subtitles: "on", "subtitle-color": "red" });
    expect(resolveSubtitles(base, false)).toBeNull();
    expect(resolveSubtitles(null, true)?.color).toBe("#ffffff");
    expect(resolveSubtitles(base, { position: "middle" })).toMatchObject({ color: "red", position: "middle" });
  });

  it("make one caption per sentence, timed by the speech", () => {
    const text = "Hi there. It costs 3.5 yen! OK";
    const captions = segmentCaptions(text, even(Array.from(text).length));
    expect(captions.map((c) => c.text)).toEqual(["Hi there.", "It costs 3.5 yen!", "OK"]);
    expect(captions[0].start).toBeCloseTo(0);
    expect(captions[1].start).toBeCloseTo(1.0);
    expect(segmentCaptions("こんにちは！ミコです。", even(11)).map((c) => c.text)).toEqual(["こんにちは！", "ミコです。"]);
  });

  it("never overlap", () => {
    const joined = joinCaptions([
      { start: 1, end: 3, text: "b" },
      { start: 0, end: 1.5, text: "a" },
    ]);
    expect(joined).toEqual([
      { start: 0, end: 1, text: "a" },
      { start: 1, end: 3, text: "b" },
    ]);
  });
});

describe("view", () => {
  it("reads background and avatar placement, resolving an image against the script folder", () => {
    const view = viewFromFrontMatter({ background: "stage.png", "avatar-x": "30%", "avatar-scale": "80%" }, "/scripts");
    expect(view).toEqual({ background: "/scripts/stage.png", avatarX: "30%", avatarY: "100%", avatarScale: "80%" });
    expect(viewFromFrontMatter({ background: "transparent" }, "/x").background).toBe("transparent");
    expect(() => viewFromFrontMatter({ "avatar-size": "80%" }, "/x")).toThrow('unknown front matter key "avatar-size"');
    expect(() => resolveView(undefined, { avatarX: "30" })).toThrow("view");
  });

  it("places the avatar so the engine's picture fits its canvas exactly", () => {
    const rig = { image: { width: 1000, height: 1000 }, view: { padTop: 0, padSide: 0 } };
    const full = avatarRect(rig, 1280, 720, resolveView(undefined));
    expect(full).toEqual({ x: 280, y: 0, w: 720, h: 720, padTop: 0 });
    const small = avatarRect(rig, 1280, 720, resolveView(undefined, { avatarX: "25%", avatarY: "90%", avatarScale: "50%" }));
    expect(small).toEqual({ x: 140, y: 288, w: 360, h: 360, padTop: 0 });
  });

  it("crops the top of the image only where the frame's edge hides the cut", () => {
    // the rig crops 10% off the top of its image, whose top edge is flat
    const rig = { image: { width: 1000, height: 1000 }, view: { padTop: -0.1, padSide: 0 } };
    expect(avatarRect(rig, 1280, 720, resolveView(undefined)).padTop).toBeCloseTo(-0.1);
    const lowered = avatarRect(rig, 1280, 720, resolveView(undefined, { avatarScale: "60%" }));
    expect(lowered.padTop).toBe(0);
    expect(lowered.w).toBe(lowered.h); // the whole square image
    expect(avatarRect(rig, 1280, 720, resolveView(undefined, { avatarScale: "60%" }), -0.1).padTop).toBeCloseTo(-0.1);
    expect(avatarAspect(rig)).toBeCloseTo(1 / 0.9);
    expect(avatarAspect(rig, 0)).toBe(1);
  });
});

describe("output", () => {
  it("picks codecs by extension and refuses transparency where it cannot be kept", () => {
    expect(outputCodecs("a.mp4", false)).toContain("libx264");
    expect(outputCodecs("a.webm", true)).toContain("yuva420p");
    expect(outputCodecs("a.mov", true)).toContain("prores_ks");
    expect(() => outputCodecs("a.mp4", true)).toThrow("cannot be transparent");
    expect(() => outputCodecs("a.gif", false)).toThrow("use .mp4, .webm or .mov");
  });
});
