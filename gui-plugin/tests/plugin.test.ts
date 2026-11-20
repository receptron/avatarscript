import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { ToolCarrier } from "avatarscript";
import { definitionText } from "../scripts/definition.ts";
import { toWav } from "avatarscript";
import {
  executeManage,
  instructionsFor,
  loadAvatarForView,
  pluginCore,
  renderVideoForView,
  TOOL_DEFINITION,
  type CardData,
  type ManageContext,
} from "../src/index.ts";
import { AVATAR_REQUEST, isAvatarRequest, isVideoRequest, parseAvatarReply, parseVideoReply, VIDEO_REQUEST } from "../src/requests.ts";
import { fetchAvatar } from "../src/vue/avatar-cache.ts";
import { captionIndexAt, captionsOf, downloadName, formatTime, isVideo, percentRect } from "../src/vue/layout.ts";

/** The card's video, in a host without live avatars. */
const videoOf = (data: CardData | undefined) => (data !== undefined && isVideo(data) ? data : undefined);
/** The card's performance, in a host with live avatars. */
const performanceOf = (data: CardData | undefined) => (data !== undefined && !isVideo(data) ? data : undefined);

const VIDEO = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
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

/** Stand-ins for the avatar and the renderer, which needs Chrome and ffmpeg. */
const offline: Partial<ToolCarrier> = {
  loadAvatar: () =>
    Promise.resolve({
      manifest: { format: "avatarscript-avatar/1", name: "test", runtime: "mesh-avatar/1", assets: { rig: "rig.json", layers: "layers.json" } },
      rig: { image: { width: 100, height: 200 } },
      assets: {},
      drawnMouths: false,
    }),
  render: (options) => writeFile(options.out, VIDEO),
};

/** A host's files in memory. */
function hostFiles(initial: Record<string, string | Uint8Array>) {
  const stored = new Map<string, string | Uint8Array>(Object.entries(initial));
  const unused = (): Promise<never> => Promise.reject(new Error("unused"));
  const bytes = (path: string): Uint8Array => {
    const content = stored.get(path);
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return typeof content === "string" ? new TextEncoder().encode(content) : content;
  };
  const byPath = {
    read: unused,
    readBytes: (path: string): Promise<Uint8Array> => Promise.resolve().then(() => bytes(path)),
    write: (path: string, content: string | Uint8Array): Promise<void> => {
      stored.set(path, content);
      return Promise.resolve();
    },
    readDir: unused,
    stat: unused,
    exists: (path: string) => Promise.resolve(stored.has(path)),
    unlink: unused,
  };
  return { byPath, stored };
}

const song = { "jinglescript/asa.mp3": new Uint8Array([1, 2, 3]), "jinglescript/asa.timing.json": JSON.stringify(timing) };
const sing = { action: "sing", audioFile: "jinglescript/asa.mp3", timingFile: "jinglescript/asa.timing.json" };

describe("the GUI Chat Protocol plugin", () => {
  it("has a tool definition generated from the library's schema (run `yarn definition`)", () => {
    expect(readFileSync(new URL("../src/definition.json", import.meta.url), "utf8")).toBe(definitionText());
    expect(TOOL_DEFINITION.name).toBe("manageAvatarScript");
    expect(pluginCore.toolDefinition).toBe(TOOL_DEFINITION);
  });

  it("sing reads the song through files.byPath, shows the video and keeps it under avatarscript/, never over an earlier one", async () => {
    const { byPath, stored } = hostFiles(song);
    const result = await executeManage({ files: { byPath } }, sing, offline);
    expect(result.toolName).toBe("manageAvatarScript");
    expect(result.title).toBe("song");
    expect(result.data).toMatchObject({ kind: "song", duration: 4, file: "avatarscript/song.mp4", captions: [{ start: 1.023, end: 3.023, text: "あさ" }] });
    expect(videoOf(result.data)?.video.startsWith("data:video/mp4;base64,")).toBe(true);
    expect(JSON.parse(result.message)).toMatchObject({ ok: true, video: "avatarscript/song.mp4", lyricLines: 1 });
    expect(result.instructions).toContain("A video of the avatar is shown to the user in a player, where it will sing the song");
    expect(stored.get("avatarscript/song.mp4")).toEqual(Buffer.from(VIDEO));
    const again = await executeManage({ files: { byPath } }, sing, offline);
    expect(videoOf(again.data)?.file).toBe("avatarscript/song-2.mp4");
  });

  it("keeps two videos that finish together under one name as two files", async () => {
    const { byPath, stored } = hostFiles(song);
    const results = await Promise.all([1, 2, 3].map(() => executeManage({ files: { byPath } }, sing, offline)));
    expect(results.map((result) => videoOf(result.data)?.file).sort()).toEqual(["avatarscript/song-2.mp4", "avatarscript/song-3.mp4", "avatarscript/song.mp4"]);
    expect([...stored.keys()].filter((path) => path.startsWith("avatarscript/")).sort()).toEqual([
      "avatarscript/song-2.mp4",
      "avatarscript/song-3.mp4",
      "avatarscript/song.mp4",
    ]);
  });

  it("uses the host's avatar when the call names none", async () => {
    const { byPath } = hostFiles(song);
    const loaded: string[] = [];
    const loadAvatar: ToolCarrier["loadAvatar"] = (location) => {
      loaded.push(location);
      return offline.loadAvatar?.(location) ?? Promise.reject(new Error("no avatar"));
    };
    await executeManage({ files: { byPath }, avatar: "/avatars/host" }, sing, { ...offline, loadAvatar });
    await executeManage({ files: { byPath }, avatar: "/avatars/host" }, { ...sing, avatar: "https://example.com/a" }, { ...offline, loadAvatar });
    expect(loaded).toEqual(["/avatars/host", "https://example.com/a"]);
  });

  it("answers in text, with no card, for the guide, bad arguments and what goes wrong", async () => {
    const { byPath } = hostFiles(song);
    const guide = await executeManage({}, { action: "getGuide" });
    expect(guide.data).toBeUndefined();
    expect(guide.message).toContain('"action": "sing"');
    expect((await executeManage({}, { action: "dance" })).message).toContain("Invalid arguments:\naction:");
    expect((await executeManage({}, sing, offline)).message).toContain("cannot read files");
    const missing = await executeManage({ files: { byPath } }, { ...sing, timingFile: "jinglescript/later.timing.json" }, offline);
    expect(missing.data).toBeUndefined();
    expect(missing.message).toBe("ENOENT: jinglescript/later.timing.json");
  });

  it("in a host whose views call back (liveAvatar), sing shows the avatar itself: a performance, nothing rendered or kept", async () => {
    const tone = toWav({ samples: Float32Array.from({ length: 4 * 24000 }, (_, i) => 0.3 * Math.sin(i / 8)), sampleRate: 24000 });
    const { byPath, stored } = hostFiles({ "jinglescript/asa.wav": tone, "jinglescript/asa.timing.json": JSON.stringify(timing) });
    const context = { files: { byPath }, liveAvatar: true };
    const rendered: string[] = [];
    const counting = {
      ...offline,
      render: async (options: Parameters<NonNullable<ToolCarrier["render"]>>[0]) =>
        void rendered.push(options.out, await writeFile(options.out, VIDEO).then(() => "")),
    };
    const result = await executeManage(context, { action: "sing", audioFile: "jinglescript/asa.wav", timingFile: "jinglescript/asa.timing.json" }, counting);
    const performance = performanceOf(result.data);
    expect(performance).toMatchObject({ kind: "song", title: "song", duration: 4 });
    expect(performance?.audio.startsWith("data:audio/wav;base64,")).toBe(true);
    expect(performance?.levels).toHaveLength(120);
    expect(result.instructions).toContain("they can download it as a video there");
    expect(rendered).toEqual([]);
    expect([...stored.keys()].filter((path) => path.startsWith("avatarscript/"))).toEqual([]);

    // The view then asks for the avatar, and for the video when the user downloads it.
    const avatar = await loadAvatarForView(context, { kind: AVATAR_REQUEST }, counting);
    expect(avatar).toMatchObject({ outcome: "ready", rig: { image: { width: 100, height: 200 } }, assets: {} });
    expect(parseAvatarReply(JSON.parse(JSON.stringify(avatar)))).toEqual(avatar);
    if (performance === undefined) throw new Error("no performance");
    const video = await renderVideoForView(context, { kind: VIDEO_REQUEST, performance }, counting);
    expect(video).toMatchObject({ outcome: "ready", file: "avatarscript/song.mp4" });
    expect(parseVideoReply(JSON.parse(JSON.stringify(video)))).toEqual(video);
    expect(rendered).toHaveLength(2);
    expect(stored.has("avatarscript/song.mp4")).toBe(true);
    expect(captionsOf(performance)).toEqual([{ start: 1, end: 3, text: "あさ" }]);
  });

  it("answers the view's requests through the same execute as the tool calls, and says why when one fails", async () => {
    const { byPath } = hostFiles(song);
    expect(isAvatarRequest({ kind: AVATAR_REQUEST })).toBe(true);
    expect(isAvatarRequest({ kind: AVATAR_REQUEST, avatar: 3 })).toBe(false);
    expect(isAvatarRequest({ action: "sing" })).toBe(false);
    expect(isVideoRequest({ kind: VIDEO_REQUEST, performance: {} })).toBe(true);
    expect(isVideoRequest({ kind: VIDEO_REQUEST })).toBe(false);
    // not a performance the tool made: refused before anything is rendered
    const context: ManageContext = { files: { byPath } };
    const refused = await pluginCore.execute(context, { kind: VIDEO_REQUEST, performance: { kind: "song" } });
    expect(refused).toMatchObject({ outcome: "failed", message: expect.stringContaining("That is not a performance this tool made") });
    const noAvatar = await loadAvatarForView({}, { kind: AVATAR_REQUEST, avatar: "/etc" }, offline);
    expect(noAvatar).toEqual({ outcome: "failed", message: "the avatar a view names must be an https URL" });
    expect(parseAvatarReply({ outcome: "ready", message: "", rig: {}, assets: { a: 1 } })).toBeUndefined();
    expect(parseVideoReply({ outcome: "ready", message: "", video: "data:text/html;base64,AAAA" })).toBeUndefined();
    expect(parseVideoReply({ outcome: "failed", message: "no" })).toEqual({ outcome: "failed", message: "no" });
  });

  it("tells the LLM what the user sees", () => {
    const video = { kind: "speech" as const, title: "t", video: "", mimeType: "video/mp4" as const, duration: 1, width: 2, height: 2, captions: [] };
    expect(instructionsFor(video)).toContain("A video of the avatar is shown to the user in a player, where it will say the script");
  });
});

describe("the avatars a page has fetched", () => {
  const reply = (name: string) => ({ outcome: "ready", message: "", rig: { name }, assets: {} });

  it("asks once for the same avatar of the same runtime, and again for another avatar or another runtime", async () => {
    const asked: object[] = [];
    const source = (name: string) => ({
      dispatch: (args: object) => {
        asked.push(args);
        return Promise.resolve(reply(name));
      },
    });
    const first = source("first");
    const second = source("second");
    expect(await fetchAvatar(first, { avatarKey: "aaaa" })).toMatchObject({ rig: { name: "first" } });
    await fetchAvatar(first, { avatarKey: "aaaa" });
    expect(asked).toEqual([{ kind: AVATAR_REQUEST }]);
    // the host's own avatar changed (another key), a named avatar, and another host in the same page
    await fetchAvatar(first, { avatarKey: "bbbb" });
    await fetchAvatar(first, { avatar: "https://example.com/a", avatarKey: "cccc" });
    expect(await fetchAvatar(second, { avatarKey: "aaaa" })).toMatchObject({ rig: { name: "second" } });
    expect(asked).toEqual([
      { kind: AVATAR_REQUEST },
      { kind: AVATAR_REQUEST },
      { kind: AVATAR_REQUEST, avatar: "https://example.com/a" },
      { kind: AVATAR_REQUEST },
    ]);
  });

  it("asks again after a request that failed", async () => {
    let calls = 0;
    const source = { dispatch: () => Promise.resolve(++calls === 1 ? { outcome: "failed", message: "not yet" } : reply("ok")) };
    await expect(fetchAvatar(source, { avatarKey: "k" })).rejects.toThrow("not yet");
    expect(await fetchAvatar(source, { avatarKey: "k" })).toMatchObject({ rig: { name: "ok" } });
  });
});

describe("the view's layout", () => {
  it("formats times, finds the caption being heard, and names the download", () => {
    expect([0, 9.4, 61, 600].map(formatTime)).toEqual(["0:00", "0:09", "1:01", "10:00"]);
    const captions = [
      { start: 1, end: 2, text: "a" },
      { start: 3, end: 4, text: "b" },
    ];
    expect([0.5, 1, 1.99, 2, 3.5, 9].map((t) => captionIndexAt(captions, t))).toEqual([-1, 0, 0, -1, 1, -1]);
    expect(downloadName({ title: "朝の歌" })).toBe("朝の歌.mp4");
    expect(downloadName({ title: "a/b:c" })).toBe("a_b_c.mp4");
    expect(downloadName({ title: "  " })).toBe("avatar.mp4");
    expect(percentRect({ x: 213, y: 0, w: 427, h: 480 }, 854, 480)).toEqual({ left: "24.94%", top: "0%", width: "50%", height: "100%" });
  });
});
