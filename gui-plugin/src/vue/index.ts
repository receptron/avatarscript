// Vue entry (browser): the view (the avatar performing live, or a video of it) and the card
// preview. It does not load the library's index (which needs Node); the tool runs on the host's
// server through the core entry, and the view uses the library's browser entry and the mesh engine.
import type { ToolPlugin } from "gui-chat-protocol/vue";
import { TOOL_DEFINITION } from "../definition.ts";
import type { CardData } from "./layout.ts";
import Preview from "./Preview.vue";
import View from "./View.vue";

export const plugin: ToolPlugin<CardData, never, object> = {
  toolDefinition: TOOL_DEFINITION,
  // Hosts run manageAvatarScript on their server (the package's main entry); a browser-only host
  // has no way to read a song's files or to speak here.
  execute: () => Promise.resolve({ message: "manageAvatarScript runs on the host's server (import the package's main entry there)." }),
  generatingMessage: "Preparing the avatar…",
  isEnabled: () => true,
  viewComponent: View,
  previewComponent: Preview,
};

export { View, Preview };
export default { plugin };
