// What the view shows, as plain functions (tested without a browser).
import type { VideoData } from "avatarscript";

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
export function downloadName(video: Pick<VideoData, "title">): string {
  const stem = video.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  return `${stem === "" ? "avatar" : stem}.mp4`;
}

export const KIND_LABELS: Record<VideoData["kind"], string> = { song: "Song", speech: "Speech" };
