import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cueActions, momentAt } from "../src/perform.ts";
import { captionCss, createPerformer, type MeshAvatarApi } from "../src/player.ts";
import { planFrames } from "../src/render.ts";
import type { Score } from "../src/score.ts";
import { SubtitleStyleSchema } from "../src/subtitles.ts";

const score: Pick<Score, "visemes" | "speaking" | "cues"> = {
  visemes: [
    [1, "aa"],
    [1.5, "kk"],
    [1.6, "oh"],
    [2, "sil"],
  ],
  speaking: [[0.9, 2]],
  cues: [
    { t: 0, emotion: "happy" },
    { t: 1.2, motion: "nod" },
    { t: 1.4, motion: "fly" },
    { t: 3, emotion: "sad" },
  ],
};
const levels = Float32Array.from({ length: 120 }, (_, i) => i / 120);

/** One frame of a 60 Hz display: one physics step. */
const FRAME = 1 / 60;

/** An avatar that records what it is told. */
function fakeAvatar() {
  const calls: string[] = [];
  const avatar: MeshAvatarApi = {
    motions: [{ id: "nod" }],
    setEmotion: (tag) => calls.push(`emotion ${tag}`),
    play: (id) => calls.push(`play ${id}`),
    setSpeaking: (on) => calls.push(`speaking ${String(on)}`),
    setVoiceLevel: (level) => calls.push(`level ${level.toFixed(2)}`),
    holdMouth: (vowel) => calls.push(`mouth ${vowel}`),
    stopLipSync: () => calls.push("mouth off"),
    setAutoMotion: (on) => calls.push(`autoMotion ${String(on)}`),
    setAutoIdle: (on) => calls.push(`autoIdle ${String(on)}`),
    advance: (seconds) => calls.push(`advance ${seconds.toFixed(3)}`),
  };
  return { avatar, calls, take: () => calls.splice(0) };
}

describe("momentAt and cueActions", () => {
  it("gives the mouth a little ahead of the sound, and the voice level only while speaking", () => {
    expect(momentAt(score, levels, 30, 0.5)).toEqual({ mouth: null, speaking: false, level: 0 });
    // 40 ms before the vowel the mouth is already on it; the avatar is speaking from 0.9 s
    expect(momentAt(score, levels, 30, 0.97)).toEqual({ mouth: "a", speaking: true, level: levels[29] });
    expect(momentAt(score, levels, 30, 1.5).mouth).toBe("n");
    expect(momentAt(score, levels, 30, 1.7).mouth).toBe("o");
    expect(momentAt(score, levels, 30, 2.5)).toEqual({ mouth: null, speaking: false, level: 0 });
    expect(momentAt(score, [], 30, 1.2).level).toBe(0);
  });

  it("hands out each cue once, in order", () => {
    expect(cueActions(score.cues, 0, 1)).toEqual({ actions: [["emotion", "happy"]], next: 1 });
    expect(cueActions(score.cues, 1, 1.3)).toEqual({ actions: [["motion", "nod"]], next: 2 });
    expect(cueActions(score.cues, 2, 1.3)).toEqual({ actions: [], next: 2 });
    expect(cueActions(score.cues, 2, 9).next).toBe(4);
  });

  it("is what the renderer plans its frames with", () => {
    const whole: Score = {
      format: "avatarscript-score/1",
      lang: "ja",
      audio: "a.wav",
      duration: 4,
      captions: [],
      subtitles: null,
      provenance: { tts: {} },
      ...score,
      view: { background: "#fff", avatarX: "50%", avatarY: "100%", avatarScale: "100%" },
    };
    const plans = planFrames(whole, levels, 30, 0.04);
    expect(plans).toHaveLength(120);
    expect(plans[29]).toEqual({ ...momentAt(score, levels, 30, 29 / 30), actions: [], caption: null });
    expect(plans.flatMap((plan) => plan.actions)).toEqual([
      ["emotion", "happy"],
      ["motion", "nod"],
      ["motion", "fly"],
      ["emotion", "sad"],
    ]);
  });
});

describe("createPerformer (the live player)", () => {
  it("sets the avatar up as the renderer does, with the score's first emotion", () => {
    const { avatar, calls } = fakeAvatar();
    createPerformer(avatar, { score, levels });
    expect(calls).toEqual(["autoMotion false", "autoIdle true", "emotion happy", "advance 1.500"]);
  });

  it("while playing, follows the time: cues once, the mouth, the voice; a motion the avatar lacks is left out", () => {
    const { avatar, take } = fakeAvatar();
    const performer = createPerformer(avatar, { score, levels });
    take();
    performer.update(1.0, FRAME, true);
    // a jump from 0 to 1 s is a seek: the emotion in force there, then the cue itself, already passed, is not replayed
    expect(take()).toEqual(["emotion happy", "speaking true", `level ${levels[30].toFixed(2)}`, "mouth a", "advance 0.017"]);
    performer.update(1.25, 0.25, true);
    expect(take()).toEqual(["play nod", "speaking true", `level ${levels[38].toFixed(2)}`, "mouth a", "advance 0.100"]);
    performer.update(1.45, FRAME, true); // "fly" is not one of this avatar's motions
    expect(take()).not.toContain("play fly");
    performer.update(1.8, FRAME, true);
    take();
    performer.update(2.2, FRAME, true);
    expect(take()).toEqual(["speaking false", "level 0.00", "mouth off", "advance 0.017"]);
  });

  it("only idles while paused, and after a seek takes the emotion in force there without replaying what was passed", () => {
    const { avatar, take } = fakeAvatar();
    const performer = createPerformer(avatar, { score, levels });
    performer.update(1.0, FRAME, true);
    take();
    performer.update(1.0, FRAME, false);
    expect(take()).toEqual(["speaking false", "level 0.00", "mouth off", "advance 0.017"]);
    performer.update(1.0, FRAME, false);
    expect(take()).toEqual(["speaking false", "level 0.00", "advance 0.017"]);
    // forward past the motions and the second emotion
    performer.update(3.5, FRAME, true);
    expect(take()).toEqual(["emotion sad", "speaking false", "level 0.00", "advance 0.017"]);
    // back to before the nod: happy again, and the nod plays when its time comes
    performer.update(1.1, FRAME, true);
    expect(take().slice(0, 1)).toEqual(["emotion happy"]);
    performer.update(1.22, FRAME, true);
    expect(take()).toContain("play nod");
    performer.update(1.3, 0, true);
    expect(take().some((call) => call.startsWith("advance"))).toBe(false);
  });

  it("takes the score's emotion again when playing resumes: the engine lets it go while paused", () => {
    const { avatar, take } = fakeAvatar();
    const performer = createPerformer(avatar, { score, levels });
    performer.update(1.0, FRAME, true);
    performer.update(1.3, FRAME, true); // the nod has played
    take();
    performer.update(1.3, FRAME, false);
    take();
    performer.update(1.3, FRAME, true);
    const resumed = take();
    expect(resumed[0]).toBe("emotion happy");
    expect(resumed).not.toContain("play nod");
    // and not on every frame while it keeps playing
    performer.update(1.32, FRAME, true);
    expect(take().some((call) => call.startsWith("emotion"))).toBe(false);
  });

  it("on resume keeps an emotion whose cue was given just before its time", () => {
    const { avatar, take } = fakeAvatar();
    const early: typeof score = {
      ...score,
      cues: [
        { t: 0, emotion: "happy" },
        { t: 1, emotion: "sad" },
      ],
    };
    const performer = createPerformer(avatar, { score: early, levels });
    for (const t of [0.2, 0.5, 0.8, 0.97]) performer.update(t, FRAME, true);
    // 30 ms before its time the cue has been given
    expect(take()).toContain("emotion sad");
    performer.update(0.97, FRAME, false);
    take();
    performer.update(0.97, FRAME, true);
    expect(take()[0]).toBe("emotion sad");
    performer.update(1.05, FRAME, true);
    expect(take().some((call) => call === "emotion happy")).toBe(false);
  });

  it("advances the engine by whole physics steps, keeping what is left over: a 240 Hz display still moves it", () => {
    const { avatar, take } = fakeAvatar();
    const performer = createPerformer(avatar, { score, levels });
    take();
    const advances: string[] = [];
    // 240 frames of 1/240 s: each is a quarter of a physics step
    for (let i = 0; i < 240; i++) {
      performer.update(0, 1 / 240, false);
      advances.push(...take().filter((call) => call.startsWith("advance")));
    }
    expect(advances).toHaveLength(60);
    expect(new Set(advances)).toEqual(new Set(["advance 0.017"]));
    // a long gap (a tab in the background) gives the engine at most a tenth of a second
    performer.update(0, 5, false);
    expect(take().at(-1)).toBe("advance 0.100");
  });
});

/** Modules reached from `entry` through relative imports, and the packages and built-ins they import. */
function importGraph(entry: string): { files: Set<string>; external: Set<string> } {
  const files = new Set<string>();
  const external = new Set<string>();
  const visit = (file: string): void => {
    if (files.has(file)) return;
    files.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(/^(?:import|export)\s(?!type\s)[^;]*?from\s+"([^"]+)"/gm)) {
      const specifier = match[1];
      if (specifier.startsWith(".")) visit(resolve(dirname(file), specifier));
      else external.add(specifier);
    }
  };
  visit(resolve(dirname(fileURLToPath(import.meta.url)), entry));
  return { files, external };
}

describe("captionCss (a subtitle style on a live stage)", () => {
  it("places and sizes the caption in shares of the stage, as the video does", () => {
    const css = captionCss(SubtitleStyleSchema.parse({}), 480);
    expect(css).toMatchObject({
      position: "absolute",
      left: "50%",
      bottom: "6cqh",
      transform: "translateX(-50%)",
      maxWidth: "90cqw",
      fontSize: "5.5cqh",
      fontWeight: "bold",
      color: "#ffffff",
      WebkitTextStroke: "0.16em #000000",
      paintOrder: "stroke fill",
    });
    expect(css).not.toHaveProperty("background");
    expect(css).not.toHaveProperty("top");
  });

  it("follows the style: position, pixel lengths, colours, a background, no outline; a font file falls back to the default font", () => {
    const style = SubtitleStyleSchema.parse({
      position: "top",
      size: "48px",
      margin: "24",
      color: "#fff8e7",
      outline: "none",
      background: "rgba(0, 0, 0, 0.35)",
      weight: "normal",
      maxWidth: "70%",
      font: "fonts/Mincho.otf",
    });
    const css = captionCss(style, 480);
    expect(css).toMatchObject({ top: "5cqh", fontSize: "10cqh", color: "#fff8e7", background: "rgba(0, 0, 0, 0.35)", fontWeight: "normal", maxWidth: "70cqw" });
    expect(css.fontFamily).toContain("Hiragino Sans");
    expect(css).not.toHaveProperty("WebkitTextStroke");
    expect(css).not.toHaveProperty("bottom");
    expect(captionCss(SubtitleStyleSchema.parse({ position: "middle", font: "Georgia, serif" }), 480)).toMatchObject({
      top: "50%",
      transform: "translate(-50%, -50%)",
      fontFamily: "Georgia, serif",
    });
  });
});

describe("avatarscript/player", () => {
  it("reaches no Node built-in and no package but zod, so a page can load it", () => {
    const { files, external } = importGraph("../src/player.ts");
    expect(files.size).toBeGreaterThan(3);
    expect([...external]).toEqual(["zod"]);
  });

  it("the walk does see Node built-ins (the Node entry reaches them)", () => {
    expect([...importGraph("../src/index.ts").external]).toEqual(expect.arrayContaining(["node:fs/promises", "puppeteer"]));
  });
});
