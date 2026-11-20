// yarn demo-data <folder> <audio> <timing.json>: has the sample avatar sing a JingleScript song (the
// two files, inside <folder>, as the plugin would be handed them by a host that shows avatars
// live) and writes demo/sample.json for `yarn demo`: the tool's result (a performance), and the
// answers to what the view will ask for (the avatar, and the video for a download).
// Needs ffmpeg, and Chrome (puppeteer) for the video; the result is not committed.
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { executeManage, loadAvatarForView, renderVideoForView } from "../src/index.ts";
import { AVATAR_REQUEST, VIDEO_REQUEST } from "../src/requests.ts";

const [folder, audioFile, timingFile] = process.argv.slice(2);
if (folder === undefined || audioFile === undefined || timingFile === undefined) throw new Error("usage: yarn demo-data <folder> <audio> <timing.json>");
const root = resolve(folder);
const unused = (): Promise<never> => Promise.reject(new Error("unused"));
const byPath = {
  read: (path: string) => readFile(join(root, path), "utf8"),
  readBytes: (path: string) => readFile(join(root, path)),
  write: async (path: string, content: string | Uint8Array) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  },
  readDir: unused,
  stat: unused,
  exists: (path: string) =>
    access(join(root, path)).then(
      () => true,
      () => false,
    ),
  unlink: unused,
};
// The sample avatar from this checkout, so the demo needs no network.
const context = { files: { byPath }, avatar: resolve(import.meta.dirname, "../../avatars/ani"), liveAvatar: true };
const result = await executeManage(context, { action: "sing", audioFile, timingFile, emotion: "happy", subtitles: true });
if (result.data === undefined || "video" in result.data) throw new Error(result.message);
// What the view will ask for: the avatar when it is shown, and the video when the user downloads it.
const avatar = await loadAvatarForView(context, { kind: AVATAR_REQUEST });
const video = await renderVideoForView(context, { kind: VIDEO_REQUEST, performance: result.data });
await writeFile(new URL("../demo/sample.json", import.meta.url), JSON.stringify({ result, avatar, video }));
console.log(`wrote demo/sample.json: ${result.message}\navatar: ${avatar.outcome}; video: ${video.outcome} ${video.message}`);
