// What the views show, as plain functions (tested without a browser).
import type { PerformanceData, VideoData } from "avatarscript";

/** What a card holds: a performance the view plays live, or a video. */
export type CardData = PerformanceData | VideoData;

/** A card that holds a video (a host without live avatars, or an earlier version's card). */
export const isVideo = (data: CardData): data is VideoData => "video" in data;

/** The words of a card and when they are heard: lyric lines, or sentences. */
export const captionsOf = (data: CardData): VideoData["captions"] => (isVideo(data) ? data.captions : data.score.captions);

/** Seconds as m:ss. */
export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** The index of the caption heard at `t` (a lyric line, a sentence), or -1 between captions. */
export function captionIndexAt(captions: VideoData["captions"], t: number): number {
  return captions.findIndex((caption) => t >= caption.start && t < caption.end);
}

/** A file name for the downloaded video, from its title. */
export function downloadName(video: { title: string }): string {
  const stem = video.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  return `${stem === "" ? "avatar" : stem}.mp4`;
}

export const KIND_LABELS: Record<CardData["kind"], string> = { song: "Song", speech: "Speech" };

/** A rectangle in a frame as CSS percentages, so the avatar keeps its place at any size of the stage. */
export function percentRect(
  rect: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
): Record<"left" | "top" | "width" | "height", string> {
  const percent = (value: number, of: number): string => `${Math.round((value / of) * 10000) / 100}%`;
  return { left: percent(rect.x, width), top: percent(rect.y, height), width: percent(rect.w, width), height: percent(rect.h, height) };
}
