import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Avatar } from "../src/avatar.ts";
import type { RenderOptions } from "../src/render.ts";
import { manage, ToolInputSchema, toolInputJsonSchema, type ToolCarrier } from "../src/tool.ts";

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
    expect(renders[1]?.score.cues).toEqual([{ t: 0, emotion: "happy" }]);
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
