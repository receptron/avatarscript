import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Avatar } from "../src/avatar.ts";
import type { RenderOptions } from "../src/render.ts";
import { toWav } from "../src/audio.ts";
import { avatarForView, manage, PerformanceSchema, renderPerformance, ToolInputSchema, toolInputJsonSchema, type ToolCarrier } from "../src/tool.ts";

const avatar: Avatar = {
  manifest: { format: "avatarscript-avatar/1", name: "test", runtime: "mesh-avatar/1", assets: { rig: "rig.json", layers: "layers.json" } },
  rig: { image: { width: 100, height: 200 } },
  assets: {},
  drawnMouths: false,
};
const timing = {
  format: "jinglescript-timing/1",
  duration: 4,
  lyrics: [
    {
      track: 0,
      line: 0,
      text: "あさ",
      t: 1,
      end: 3,
      syllables: [
        { text: "あ", t: 1, end: 2 },
        { text: "さ", t: 2, end: 3 },
      ],
    },
  ],
};
const VIDEO = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);

let cacheDir = "";
beforeAll(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "avatarscript-tool-"));
});
afterAll(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

/** A carrier with files in memory, an avatar that is not loaded, and a renderer that writes a stand-in video. */
function carrier(files: Record<string, string | Uint8Array> = {}) {
  const stored = new Map<string, Uint8Array>();
  const renders: RenderOptions[] = [];
  const loaded: string[] = [];
  const made: ToolCarrier = {
    readFile: (path) => {
      const content = files[path];
      if (content === undefined) return Promise.reject(new Error(`no such file: ${path}`));
      return Promise.resolve(typeof content === "string" ? new TextEncoder().encode(content) : content);
    },
    saveFile: (name, content) => {
      if (stored.has(name)) return Promise.resolve(undefined);
      stored.set(name, content);
      return Promise.resolve(`avatarscript/${name}`);
    },
    loadAvatar: (location) => {
      loaded.push(location);
      return Promise.resolve(avatar);
    },
    render: async (options) => {
      renders.push(options);
      await writeFile(options.out, VIDEO);
    },
    ttsCacheDir: cacheDir,
  };
  return { carrier: made, stored, renders, loaded };
}

const song = { "jinglescript/asa.mp3": new Uint8Array([1, 2, 3]), "jinglescript/asa.timing.json": JSON.stringify(timing) };
const singInput = ToolInputSchema.parse({ action: "sing", audioFile: "jinglescript/asa.mp3", timingFile: "jinglescript/asa.timing.json" });

describe("manageAvatarScript: sing", () => {
  it("makes a video of the avatar singing a JingleScript song, keeps it, and tells the model where", async () => {
    const { carrier: made, stored, renders, loaded } = carrier(song);
    const result = await manage(singInput, made);
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toMatchObject({ ok: true, video: "avatarscript/song.mp4", duration: 4, size: "854x480", lyricLines: 1 });
    expect(result.video).toMatchObject({
      kind: "song",
      title: "song",
      video: `data:video/mp4;base64,${Buffer.from(VIDEO).toString("base64")}`,
      mimeType: "video/mp4",
      duration: 4,
      width: 854,
      height: 480,
      file: "avatarscript/song.mp4",
    });
    expect(result.video?.captions).toEqual([{ start: 1.023, end: 3.023, text: "あさ" }]);
    expect(stored.get("song.mp4")).toEqual(Buffer.from(VIDEO));
    expect(loaded).toEqual(["https://raw.githubusercontent.com/receptron/mulmocast-media/main/avatars/ani"]);
    // The song's own audio is what the video plays, and the mouth allows for the MP3's delay.
    expect(renders[0]?.audioPath.endsWith("song.mp3")).toBe(true);
    expect(renders[0]?.score.visemes[0]).toEqual([1.023, "aa"]);
    expect(renders[0]).toMatchObject({ width: 854, height: 480, avatar });
  });

  it("never overwrites a video, passes the options on, and uses the avatar the call or the carrier names", async () => {
    const { carrier: made, stored, renders, loaded } = carrier(song);
    await manage(singInput, made);
    const second = await manage(
      { ...singInput, emotion: "happy", subtitles: true, avatar: "https://example.com/avatars/me" },
      { ...made, avatar: "/avatars/host" },
    );
    expect(JSON.parse(second.text)).toMatchObject({ video: "avatarscript/song-2.mp4" });
    expect([...stored.keys()]).toEqual(["song.mp4", "song-2.mp4"]);
    expect(renders[1]).toMatchObject({ subtitles: true });
    expect(renders[1]?.score.cues).toEqual([
      { t: 0, emotion: "happy" },
      { t: 0.873, emotion: "happy" },
    ]);
    await manage({ ...singInput, fileName: "morning" }, { ...made, avatar: "/avatars/host" });
    expect(loaded).toEqual([expect.stringContaining("mulmocast-media"), "https://example.com/avatars/me", "/avatars/host"]);
    expect([...stored.keys()]).toContain("morning.mp4");
  });

  it("without a carrier that keeps files, the video is only in the result", async () => {
    const { carrier: made } = carrier(song);
    const result = await manage(singInput, { ...made, saveFile: undefined });
    expect(JSON.parse(result.text)).not.toHaveProperty("video");
    expect(result.video?.file).toBeUndefined();
    expect(result.video?.video.startsWith("data:video/mp4;base64,")).toBe(true);
  });

  it("tells the model what is wrong: missing paths, a host without files, a wrong file, a song without lyrics", async () => {
    const { carrier: made } = carrier({
      ...song,
      "x/notes.timing.json": JSON.stringify({ format: "jinglescript-timing/1", duration: 2 }),
      "x/score.json": "{}",
    });
    const text = async (input: object, with_: ToolCarrier = made) => (await manage(ToolInputSchema.parse({ action: "sing", ...input }), with_)).text;
    expect(await text({ audioFile: "a.mp3" })).toContain("sing needs `audioFile` and `timingFile`");
    expect(await text({ audioFile: "a.mp3", timingFile: "a.json" }, {})).toContain("cannot read files");
    expect(await text({ audioFile: "../a.mp3", timingFile: "a.json" })).toContain("`audioFile` must name an audio file");
    expect(await text({ audioFile: "a.json", timingFile: "a.json" })).toContain("`audioFile` must name an audio file");
    expect(await text({ audioFile: "a.mp3", timingFile: "a.mp3" })).toContain("`timingFile` must name a .json file");
    expect(await text({ audioFile: "a.mp3", timingFile: "missing.json" })).toBe("no such file: missing.json");
    expect(await text({ audioFile: "jinglescript/asa.mp3", timingFile: "x/notes.timing.json" })).toContain("the timing map has no lyrics");
    expect(await text({ audioFile: "jinglescript/asa.mp3", timingFile: "x/score.json" })).toContain("x/score.json is not valid");
    const failed = await manage(singInput, { ...made, render: () => Promise.reject(new Error("Chrome did not start")) });
    expect(failed).toEqual({ text: "Chrome did not start", isError: true });
  });
});

describe("manageAvatarScript: speak", () => {
  it("makes a video of the avatar saying a script, with the provider this computer is set up for", async () => {
    vi.stubEnv("AVATARSCRIPT_TTS", "mock");
    const { carrier: made, renders, stored } = carrier();
    const result = await manage(
      ToolInputSchema.parse({ action: "speak", script: "[emotion:happy] こんにちは！<nod>", subtitles: true, fileName: "hello" }),
      made,
    );
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toMatchObject({ ok: true, video: "avatarscript/hello.mp4", sentences: 1 });
    expect(result.video).toMatchObject({ kind: "speech", title: "hello", captions: [expect.objectContaining({ text: "こんにちは！" })] });
    expect(renders[0]?.score.lang).toBe("ja");
    expect(renders[0]?.score.cues).toEqual(expect.arrayContaining([expect.objectContaining({ emotion: "happy" }), expect.objectContaining({ motion: "nod" })]));
    expect(renders[0]?.audioPath.endsWith("speech.wav")).toBe(true);
    expect(stored.has("hello.mp4")).toBe(true);
  });

  it("tells the model when there is nothing to say, a script that does not parse, a file in it, or no key", async () => {
    const { carrier: made } = carrier();
    const text = async (input: object) => (await manage(ToolInputSchema.parse({ action: "speak", ...input }), made)).text;
    expect(await text({})).toContain("speak needs `script`");
    vi.stubEnv("AVATARSCRIPT_TTS", "mock");
    expect(await text({ script: "[pause:soon] hello" })).toContain("line 1: pause must look like");
    expect(await text({ script: "---\nbackground: stage.png\n---\nhello" })).toContain("`background` cannot be a file here");
    vi.stubEnv("AVATARSCRIPT_TTS", "");
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(await text({ script: "hello" })).toContain("no text-to-speech key is set");
    vi.stubEnv("AVATARSCRIPT_TTS", "loud");
    expect(await text({ script: "hello" })).toContain('unknown text-to-speech provider: "loud"');
  });
});

describe("manageAvatarScript: a carrier whose view shows the avatar itself (live)", () => {
  // A 16-bit mono WAV at the rate audio is read at, so the voice levels need no ffmpeg.
  const tone = toWav({ samples: Float32Array.from({ length: 4 * 24000 }, (_, i) => (i > 24000 && i < 72000 ? 0.3 * Math.sin(i / 8) : 0)), sampleRate: 24000 });
  const liveSong = { "jinglescript/asa.wav": tone, "jinglescript/asa.timing.json": JSON.stringify(timing) };
  const liveInput = ToolInputSchema.parse({ action: "sing", audioFile: "jinglescript/asa.wav", timingFile: "jinglescript/asa.timing.json", subtitles: true });

  it("sing answers at once with a performance: the score, the audio and the voice levels, and nothing is rendered or loaded", async () => {
    const { carrier: made, renders, loaded, stored } = carrier(liveSong);
    const result = await manage(liveInput, { ...made, live: true });
    expect(result.isError).toBe(false);
    expect(result.video).toBeUndefined();
    expect(JSON.parse(result.text)).toMatchObject({ ok: true, duration: 4, lyricLines: 1, shown: expect.stringContaining("performs it in the player") });
    const performance = result.performance;
    expect(performance).toMatchObject({ kind: "song", title: "song", duration: 4, width: 854, height: 480, subtitles: true });
    expect(performance?.avatar).toBeUndefined();
    // which avatar it is, without where the carrier's own is from: the same for the same avatar, another for another
    expect(performance?.avatarKey).toMatch(/^[0-9a-f]{16}$/);
    const elsewhere = await manage(liveInput, { ...made, live: true, avatar: "/avatars/host" });
    expect(elsewhere.performance?.avatarKey).not.toBe(performance?.avatarKey);
    expect(JSON.stringify(elsewhere.performance)).not.toContain("/avatars/host");
    expect(performance?.audio).toBe(`data:audio/wav;base64,${tone.toString("base64")}`);
    // a WAV is on time: the mouth is where the timing map says
    expect(performance?.score.visemes[0]).toEqual([1, "aa"]);
    expect(performance?.score.captions).toEqual([{ start: 1, end: 3, text: "あさ" }]);
    // one level per frame at 30 fps: silent in the first second, loud in the second
    expect(performance?.levels).toHaveLength(120);
    expect(performance?.levels[10]).toBe(0);
    expect(performance?.levels[45]).toBeGreaterThan(0.5);
    expect([renders, loaded, [...stored]]).toEqual([[], [], []]);
    expect(PerformanceSchema.safeParse(JSON.parse(JSON.stringify(performance))).success).toBe(true);
  });

  it("speak answers with a performance too, and a call's avatar is carried for the view", async () => {
    vi.stubEnv("AVATARSCRIPT_TTS", "mock");
    const { carrier: made, renders } = carrier();
    const result = await manage(ToolInputSchema.parse({ action: "speak", script: "こんにちは。", avatar: "https://example.com/avatars/me" }), {
      ...made,
      live: true,
    });
    expect(result.performance).toMatchObject({ kind: "speech", title: "speech", subtitles: false, avatar: "https://example.com/avatars/me" });
    expect(result.performance?.audio.startsWith("data:audio/wav;base64,")).toBe(true);
    expect(result.performance?.levels.some((level) => level > 0.5)).toBe(true);
    expect(renders).toEqual([]);
  });

  it("subtitles are what the call says, else what the script says: an explicit false turns a script's subtitles off", async () => {
    vi.stubEnv("AVATARSCRIPT_TTS", "mock");
    const { carrier: made } = carrier(liveSong);
    const live = { ...made, live: true };
    const script = "---\nsubtitles: on\nsubtitle-position: top\n---\nこんにちは。";
    const speak = async (subtitles?: boolean) =>
      (await manage(ToolInputSchema.parse({ action: "speak", script, ...(subtitles === undefined ? {} : { subtitles }) }), live)).performance;
    expect((await speak())?.subtitles).toBe(true);
    expect((await speak())?.score.subtitles?.position).toBe("top");
    expect((await speak(false))?.subtitles).toBe(false);
    expect((await speak(true))?.subtitles).toBe(true);
    const sung = await manage(ToolInputSchema.parse({ action: "sing", audioFile: "jinglescript/asa.wav", timingFile: "jinglescript/asa.timing.json" }), live);
    expect(sung.performance?.subtitles).toBe(false);
  });

  it("avatarForView gives the avatar a performance names, or the carrier's, and takes only an https URL from a view", async () => {
    const { carrier: made, loaded } = carrier();
    expect(await avatarForView(undefined, { ...made, avatar: "/avatars/host" })).toEqual({ rig: avatar.rig, assets: avatar.assets });
    await avatarForView("https://example.com/avatars/me", { ...made, avatar: "/avatars/host" });
    expect(loaded).toEqual(["/avatars/host", "https://example.com/avatars/me"]);
    await expect(avatarForView("/etc/passwd", made)).rejects.toThrow("must be an https URL");
    await expect(avatarForView("http://example.com/a", made)).rejects.toThrow("must be an https URL");
  });

  it("renderPerformance makes the video of a performance a view sends back, and keeps it", async () => {
    const { carrier: made, renders, stored, loaded } = carrier(liveSong);
    const { performance } = await manage({ ...liveInput, fileName: "morning" }, { ...made, live: true });
    const sent: unknown = JSON.parse(JSON.stringify(performance));
    const result = await renderPerformance(sent, { ...made, avatar: "/avatars/host" });
    expect(result.isError).toBe(false);
    expect(result.video).toMatchObject({ kind: "song", title: "morning", duration: 4, width: 854, height: 480, file: "avatarscript/morning.mp4" });
    expect(stored.has("morning.mp4")).toBe(true);
    expect(loaded).toEqual(["/avatars/host"]);
    expect(renders[0]).toMatchObject({ width: 854, height: 480, subtitles: true });
    expect(renders[0]?.audioPath.endsWith("audio.wav")).toBe(true);
    expect(renders[0]?.score.visemes[0]).toEqual([1, "aa"]);
  });

  it("renderPerformance refuses what is not a performance, and one that names a file or another kind of audio", async () => {
    const { carrier: made, renders } = carrier(liveSong);
    const { performance } = await manage(liveInput, { ...made, live: true });
    if (performance === undefined) throw new Error("no performance");
    expect((await renderPerformance({ kind: "song" }, made)).text).toContain("That is not a performance this tool made");
    const background = { ...performance, score: { ...performance.score, view: { ...performance.score.view, background: "/Users/me/secret.png" } } };
    expect((await renderPerformance(background, made)).text).toContain("may not name a file");
    expect((await renderPerformance({ ...performance, audio: "data:text/html;base64,AAAA" }, made)).isError).toBe(true);
    expect((await renderPerformance({ ...performance, avatar: "/etc" }, made)).isError).toBe(true);
    // the length that is rendered is the score's: it cannot differ from the checked one, nor exceed an hour
    const longer = { ...performance, score: { ...performance.score, duration: 100_000_000 } };
    expect((await renderPerformance(longer, made)).text).toContain("must be the performance's duration");
    const hours = { ...performance, duration: 7200, score: { ...performance.score, duration: 7200 } };
    expect((await renderPerformance(hours, made)).isError).toBe(true);
    expect(renders).toEqual([]);
  });
});

describe("manageAvatarScript: the guide and the schema", () => {
  it("getGuide says how to sing and how to write a script", async () => {
    const guide = (await manage({ action: "getGuide" })).text;
    expect(guide).toContain('"action": "sing"');
    expect(guide).toContain("[emotion:NAME]");
    expect(guide).toContain("neutral, happy, sad, angry, surprised, relaxed");
  });

  it("refuses arguments it does not know, a path as a file name, and an avatar that is not an https URL", () => {
    expect(ToolInputSchema.safeParse({ action: "sing", loud: true }).success).toBe(false);
    expect(ToolInputSchema.safeParse({ action: "sing", fileName: "../x" }).success).toBe(false);
    expect(ToolInputSchema.safeParse({ action: "sing", avatar: "/etc" }).success).toBe(false);
    expect(ToolInputSchema.safeParse({ action: "sing", avatar: "http://example.com/a" }).success).toBe(false);
    expect(ToolInputSchema.safeParse({ action: "speak", tts: "mock" }).success).toBe(false);
    expect(toolInputJsonSchema()).toMatchObject({ type: "object", required: ["action"] });
  });
});
