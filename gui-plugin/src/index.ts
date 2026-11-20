// Core entry (Node): the manageAvatarScript tool for GUI Chat Protocol hosts. The host runs
// `execute` on its server (the renderer needs Chrome and ffmpeg); a video that was made comes back
// as `data` (VideoData) that the Vue view in "./vue" plays. getGuide and every error answer the
// LLM in text and show no card.
// A song's `audioFile` and `timingFile` are read through the host's `files.byPath` (as
// manageJingleScript's score `path` is): the host decides what a path may reach. Without it, sing
// is refused. With it, every video is also kept under avatarscript/, and its path goes back to
// the LLM.
import type { FileOps, ToolContext, ToolPluginCore, ToolResult } from "gui-chat-protocol";
import { manage, TOOL_NAME, ToolInputSchema, type ToolCarrier, type VideoData } from "avatarscript";
import { TOOL_DEFINITION } from "./definition.ts";

export { TOOL_DEFINITION };
export type { VideoData };

/** What a host may hand `execute` beyond the protocol's ToolContext. */
export interface ManageContext extends ToolContext {
  /** File access by path: a song's audio and timing map are read through it, and videos are kept through it. */
  files?: { byPath?: FileOps };
  /** The avatar when a call names none: a folder on the host or an https URL (default: the library's sample avatar). */
  avatar?: string;
}

/** Where videos are kept through the host's files. */
const VIDEO_DIR = "avatarscript";

/** Never overwrites: a name that is taken answers undefined, and the tool tries another. */
async function saveVideo(files: FileOps, name: string, content: Uint8Array): Promise<string | undefined> {
  const path = `${VIDEO_DIR}/${name}`;
  if (await files.exists(path)) return undefined;
  await files.write(path, content);
  return path;
}

/** What the LLM is told the user now sees. */
export function instructionsFor(video: VideoData): string {
  const what = video.kind === "song" ? "The avatar singing the song" : "The avatar saying the script";
  return `${what} is shown to the user as a video in a player; it starts when they press play. Say in a few words that it is ready, ask whether it fits, and offer changes.`;
}

/** `overrides` replaces parts of the carrier (tests stand in for the renderer, which needs Chrome and ffmpeg). */
export async function executeManage(context: ManageContext, args: object, overrides: Partial<ToolCarrier> = {}): Promise<ToolResult<VideoData, never>> {
  const input = ToolInputSchema.safeParse(args);
  if (!input.success) {
    const problems = input.error.issues.map((issue) => `${issue.path.join(".") || "(arguments)"}: ${issue.message}`);
    return { toolName: TOOL_NAME, message: `Invalid arguments:\n${problems.join("\n")}` };
  }
  const byPath = context.files?.byPath;
  const result = await manage(input.data, {
    ...(byPath
      ? {
          readFile: (path: string) => byPath.readBytes(path),
          saveFile: (name: string, content: Uint8Array) => saveVideo(byPath, name, content),
        }
      : {}),
    ...(context.avatar === undefined ? {} : { avatar: context.avatar }),
    ...overrides,
  });
  if (result.video === undefined) return { toolName: TOOL_NAME, message: result.text };
  return { toolName: TOOL_NAME, title: result.video.title, message: result.text, data: result.video, instructions: instructionsFor(result.video) };
}

export const pluginCore: ToolPluginCore<VideoData, never, object> = {
  toolDefinition: TOOL_DEFINITION,
  execute: (context, args) => executeManage(context, args),
  generatingMessage: "Making the avatar's video…",
  isEnabled: () => true,
};
