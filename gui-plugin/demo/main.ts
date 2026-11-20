// yarn demo: the view and the card preview with a real result (demo/sample.json, written by
// `yarn demo-data`), as a host that shows avatars live would mount them. The stand-in runtime
// answers the view's requests with what the tool's server side answered when the data was made.
import type { ToolResultComplete } from "gui-chat-protocol";
import { PLUGIN_RUNTIME_KEY, type BrowserPluginRuntime } from "gui-chat-protocol/vue";
import { createApp, h, ref } from "vue";
import { AVATAR_REQUEST } from "../src/requests.ts";
import type { CardData } from "../src/vue/layout.ts";
import Preview from "../src/vue/Preview.vue";
import View from "../src/vue/View.vue";

const response = await fetch("./sample.json");
if (!response.ok) throw new Error("demo/sample.json is missing: run `yarn demo-data <folder> <audio> <timing.json>` first");
// The demo's own file, written by this package's script: used as what it is.
const sample = (await response.json()) as { result: ToolResultComplete<CardData>; avatar: object; video: object };
const result = { ...sample.result, uuid: "demo" };

/** ?broken: the avatar cannot be fetched, to see what the card does then (the sound still plays). */
const broken = new URLSearchParams(location.search).has("broken");

/** How long the stand-in takes to "make" the video, so the waiting state can be seen. */
const VIDEO_MS = 1500;

const runtime: BrowserPluginRuntime = {
  pubsub: { subscribe: () => () => undefined },
  locale: ref("en"),
  log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
  openUrl: (url: string) => window.open(url, "_blank", "noopener,noreferrer"),
  dispatch: (args: object) =>
    Reflect.get(args, "kind") === AVATAR_REQUEST
      ? Promise.resolve(broken ? { outcome: "failed", message: "this demo was opened with ?broken" } : sample.avatar)
      : new Promise((resolve) => setTimeout(() => resolve(sample.video), VIDEO_MS)),
};

createApp({ render: () => h(Preview, { result }) }).mount("#preview");
createApp({ render: () => h(View, { selectedResult: result }) })
  .provide(PLUGIN_RUNTIME_KEY, runtime)
  .mount("#view");
