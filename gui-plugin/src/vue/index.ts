// Vue entry (browser): the video view and the card preview. It does not load the library (which
// needs Node, Chrome and ffmpeg); the tool runs on the host's server through the core entry.
import type { ToolPlugin } from "gui-chat-protocol/vue";
import type { VideoData } from "avatarscript";
import { TOOL_DEFINITION } from "../definition.ts";
import Preview from "./Preview.vue";
import View from "./View.vue";

export const plugin: ToolPlugin<VideoData, never, object> = {
  toolDefinition: TOOL_DEFINITION,
  // Hosts run manageAvatarScript on their server (the package's main entry); a browser-only host
  // has no way to render a video here.
  execute: () => Promise.resolve({ message: "manageAvatarScript runs on the host's server (import the package's main entry there)." }),
  generatingMessage: "Making the avatar's video…",
  isEnabled: () => true,
  viewComponent: View,
  previewComponent: Preview,
};

export { View, Preview };
export default { plugin };
