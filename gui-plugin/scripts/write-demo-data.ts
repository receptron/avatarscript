// yarn demo-data <folder> <audio> <timing.json>: makes a real video of the sample avatar singing a
// JingleScript song (the two files, inside <folder>, as the plugin would be handed them by a
// host) and writes the tool's result to demo/sample.json, for `yarn demo` to show in the view.
// Needs Chrome (puppeteer) and ffmpeg; the result is not committed.
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { executeManage } from "../src/index.ts";

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
const avatar = resolve(import.meta.dirname, "../../avatars/ani");
const result = await executeManage({ files: { byPath }, avatar }, { action: "sing", audioFile, timingFile, emotion: "happy", subtitles: true });
if (result.data === undefined) throw new Error(result.message);
await writeFile(new URL("../demo/sample.json", import.meta.url), JSON.stringify(result));
console.log(`wrote demo/sample.json: ${result.message}`);
