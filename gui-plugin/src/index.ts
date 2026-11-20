// Core entry (Node): the manageAvatarScript tool for GUI Chat Protocol hosts. The host runs
// `execute` on its server; what sing or speak made comes back as `data` that the Vue view in
// "./vue" shows. getGuide and every error answer the LLM in text and show no card.
//
// A song's `audioFile` and `timingFile` are read through the host's `files.byPath` (as
// manageJingleScript's score `path` is): the host decides what a path may reach. Without it, sing
// is refused. With it, every video that is made is also kept under avatarscript/.
//
// A host whose views can call back (`liveAvatar`: it gives the view a runtime with `dispatch` to
// this execute) gets a performance instead of a video: the avatar performs in the view itself, at
// once, with the mesh engine in the browser. The view asks here for the avatar when it is shown,
// and for a video only when the user wants a file. Without `liveAvatar`, the video is rendered on
// the server (Chrome and ffmpeg) before the call answers, and embedded.
import type { FileOps, ToolContext, ToolPluginCore, ToolResult } from "gui-chat-protocol";
import { avatarForView, manage, renderPerformance, TOOL_NAME, ToolInputSchema, type PerformanceData, type ToolCarrier, type VideoData } from "avatarscript";
import { TOOL_DEFINITION } from "./definition.ts";
import { isAvatarRequest, isVideoRequest, type AvatarReply, type AvatarRequest, type VideoReply, type VideoRequest } from "./requests.ts";

export { TOOL_DEFINITION };
export type { PerformanceData, VideoData };

/** What a card shows: a performance the view plays live, or a video (a host without `liveAvatar`, or an earlier version's card). */
export type CardData = PerformanceData | VideoData;

/** What a host may hand `execute` beyond the protocol's ToolContext. */
export interface ManageContext extends ToolContext {
  /** File access by path: a song's audio and timing map are read through it, and videos are kept through it. */
  files?: { byPath?: FileOps };
  /** The avatar when a call names none: a folder on the host or an https URL (default: the library's sample avatar). */
  avatar?: string;
  /** The host's views can call back (a runtime with `dispatch` to this execute): the avatar then performs live in the view. */
  liveAvatar?: boolean;
}

/** Where videos are kept through the host's files. */
const VIDEO_DIR = "avatarscript";

/** Paths being written by a call that has not finished: the host's files do not show them yet. */
const writing = new Set<string>();

/**
 * Never overwrites: a name that is taken answers undefined, and the tool tries another. Taken
 * also means being written right now by another call, so two videos that finish together under
 * one name are kept as two files.
 */
async function saveVideo(files: FileOps, name: string, content: Uint8Array): Promise<string | undefined> {
  const path = `${VIDEO_DIR}/${name}`;
  if (writing.has(path)) return undefined;
  // Held before the first await, so the check and the write are one step among this server's calls.
  writing.add(path);
  try {
    if (await files.exists(path)) return undefined;
    await files.write(path, content);
    return path;
  } finally {
    writing.delete(path);
  }
}

/** The tool's carrier in this host; `overrides` replaces parts of it (tests stand in for the renderer, which needs Chrome and ffmpeg). */
function carrierOf(context: ManageContext, overrides: Partial<ToolCarrier>): ToolCarrier {
  const byPath = context.files?.byPath;
  return {
    ...(byPath
      ? {
          readFile: (path: string) => byPath.readBytes(path),
          saveFile: (name: string, content: Uint8Array) => saveVideo(byPath, name, content),
        }
      : {}),
    ...(context.avatar === undefined ? {} : { avatar: context.avatar }),
    live: context.liveAvatar === true,
    ...overrides,
  };
}

/** What the LLM is told the user now sees. */
export function instructionsFor(data: CardData): string {
  const what = data.kind === "song" ? "sing the song" : "say the script";
  const shown =
    "video" in data
      ? `A video of the avatar is shown to the user in a player, where it will ${what} when they press play.`
      : `The avatar is shown to the user in a player, where it will ${what} when they press play; they can download it as a video there.`;
  return `${shown} Say in a few words that it is ready, ask whether it fits, and offer changes.`;
}

export async function executeManage(context: ManageContext, args: object, overrides: Partial<ToolCarrier> = {}): Promise<ToolResult<CardData, never>> {
  const input = ToolInputSchema.safeParse(args);
  if (!input.success) {
    const problems = input.error.issues.map((issue) => `${issue.path.join(".") || "(arguments)"}: ${issue.message}`);
    return { toolName: TOOL_NAME, message: `Invalid arguments:\n${problems.join("\n")}` };
  }
  const result = await manage(input.data, carrierOf(context, overrides));
  const data = result.performance ?? result.video;
  if (data === undefined) return { toolName: TOOL_NAME, message: result.text };
  return { toolName: TOOL_NAME, title: data.title, message: result.text, data, instructions: instructionsFor(data) };
}

/** The answer to a view's AvatarRequest: the avatar as the mesh engine takes it. */
export async function loadAvatarForView(context: ManageContext, request: AvatarRequest, overrides: Partial<ToolCarrier> = {}): Promise<AvatarReply> {
  try {
    return { outcome: "ready", message: "The avatar.", ...(await avatarForView(request.avatar, carrierOf(context, overrides))) };
  } catch (error) {
    return { outcome: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}

/** The answer to a view's VideoRequest: the performance rendered to a video now, and kept. */
export async function renderVideoForView(context: ManageContext, request: VideoRequest, overrides: Partial<ToolCarrier> = {}): Promise<VideoReply> {
  const result = await renderPerformance(request.performance, carrierOf(context, overrides));
  if (result.video === undefined) return { outcome: "failed", message: result.text };
  return {
    outcome: "ready",
    message: "The video is ready.",
    video: result.video.video,
    ...(result.video.file === undefined ? {} : { file: result.video.file }),
  };
}

export const pluginCore: ToolPluginCore<CardData, never, object> = {
  toolDefinition: TOOL_DEFINITION,
  // The view's requests come through the same execute (the host's dispatch route) as the tool calls.
  execute: (context, args) => {
    if (isAvatarRequest(args)) return loadAvatarForView(context, args);
    if (isVideoRequest(args)) return renderVideoForView(context, args);
    return executeManage(context, args);
  },
  generatingMessage: "Preparing the avatar…",
  isEnabled: () => true,
};
