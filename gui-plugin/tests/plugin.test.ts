import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { ToolCarrier } from "avatarscript";
import { definitionText } from "../scripts/definition.ts";
import { executeManage, instructionsFor, pluginCore, TOOL_DEFINITION } from "../src/index.ts";
import { captionIndexAt, downloadName, formatTime } from "../src/vue/layout.ts";

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
    expect(result.data?.video.startsWith("data:video/mp4;base64,")).toBe(true);
    expect(JSON.parse(result.message)).toMatchObject({ ok: true, video: "avatarscript/song.mp4", lyricLines: 1 });
    expect(result.instructions).toContain("The avatar singing the song is shown to the user as a video");
    expect(stored.get("avatarscript/song.mp4")).toEqual(Buffer.from(VIDEO));
    const again = await executeManage({ files: { byPath } }, sing, offline);
    expect(again.data?.file).toBe("avatarscript/song-2.mp4");
  });

  it("keeps two videos that finish together under one name as two files", async () => {
    const { byPath, stored } = hostFiles(song);
    const results = await Promise.all([1, 2, 3].map(() => executeManage({ files: { byPath } }, sing, offline)));
    expect(results.map((result) => result.data?.file).sort()).toEqual(["avatarscript/song-2.mp4", "avatarscript/song-3.mp4", "avatarscript/song.mp4"]);
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

  it("tells the LLM what the user sees", () => {
    expect(instructionsFor({ kind: "speech", title: "t", video: "", mimeType: "video/mp4", duration: 1, width: 2, height: 2, captions: [] })).toContain(
      "The avatar saying the script is shown",
    );
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
  });
});
