// What the view asks of the tool's server side, and the answers. A live card (a performance)
// holds no avatar and no video: the view asks for the avatar when it is shown, and for the video
// when the user wants a file. It sends these through the host's runtime dispatch, which reaches
// the same execute as the LLM's tool calls; execute answers them before reading a call as a tool
// call. Shared by both entries, so the two sides cannot drift apart.
import type { AvatarAssets, PerformanceData } from "avatarscript";

/** `kind` of the view's requests; not manageAvatarScript actions, so the LLM never sends them. */
export const AVATAR_REQUEST = "loadAvatar";
export const VIDEO_REQUEST = "renderVideo";

export interface AvatarRequest {
  kind: typeof AVATAR_REQUEST;
  /** The performance's `avatar` (an https URL); absent: the host's own avatar. */
  avatar?: string;
}

export interface VideoRequest {
  kind: typeof VIDEO_REQUEST;
  /** The card's performance, as the tool made it. */
  performance: PerformanceData;
}

/** Every reply has a `message`, as a tool's answer does: the host's route carries both alike. */
export type AvatarReply = ({ outcome: "ready"; message: string } & AvatarAssets) | { outcome: "failed"; message: string };
export type VideoReply = { outcome: "ready"; message: string; video: string; file?: string } | { outcome: "failed"; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export function isAvatarRequest(args: unknown): args is AvatarRequest {
  return isRecord(args) && args["kind"] === AVATAR_REQUEST && (args["avatar"] === undefined || typeof args["avatar"] === "string");
}

export function isVideoRequest(args: unknown): args is VideoRequest {
  return isRecord(args) && args["kind"] === VIDEO_REQUEST && isRecord(args["performance"]);
}

const isAssets = (value: unknown): value is Record<string, string> => isRecord(value) && Object.values(value).every((asset) => typeof asset === "string");

/** The avatar reply as the view receives it (JSON from the host), checked; undefined when it is not one. */
export function parseAvatarReply(raw: unknown): AvatarReply | undefined {
  if (!isRecord(raw) || typeof raw["message"] !== "string") return undefined;
  const message = raw["message"];
  if (raw["outcome"] === "ready")
    return isRecord(raw["rig"]) && isAssets(raw["assets"]) ? { outcome: "ready", message, rig: raw["rig"], assets: raw["assets"] } : undefined;
  return raw["outcome"] === "failed" ? { outcome: "failed", message } : undefined;
}

/** The video reply as the view receives it, checked; undefined when it is not one. */
export function parseVideoReply(raw: unknown): VideoReply | undefined {
  if (!isRecord(raw) || typeof raw["message"] !== "string") return undefined;
  const message = raw["message"];
  if (raw["outcome"] === "ready") {
    const { video, file } = raw;
    if (typeof video !== "string" || !video.startsWith("data:video/mp4;base64,")) return undefined;
    return { outcome: "ready", message, video, ...(typeof file === "string" ? { file } : {}) };
  }
  return raw["outcome"] === "failed" ? { outcome: "failed", message } : undefined;
}
