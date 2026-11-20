// yarn demo: the view and the card preview with a real result (demo/sample.json, written by
// `yarn demo-data`), as a host would mount them.
import type { ToolResultComplete } from "gui-chat-protocol";
import type { VideoData } from "avatarscript";
import { createApp, h } from "vue";
import Preview from "../src/vue/Preview.vue";
import View from "../src/vue/View.vue";

const response = await fetch("./sample.json");
if (!response.ok) throw new Error("demo/sample.json is missing: run `yarn demo-data <folder> <audio> <timing.json>` first");
const tool: unknown = await response.json();
// The demo's own file, written by this package's script: shown as the result it is.
const result = { ...(tool as ToolResultComplete<VideoData>), uuid: "demo" };

createApp({ render: () => h(Preview, { result }) }).mount("#preview");
createApp({ render: () => h(View, { selectedResult: result }) }).mount("#view");
