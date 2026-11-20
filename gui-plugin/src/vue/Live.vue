<script setup lang="ts">
// The avatar performing live: the mesh engine draws it in this card, following the audio's time,
// so nothing is rendered beforehand. The avatar itself is fetched from the tool's server side when
// the card is shown; until the user presses play it idles (it blinks and breathes). A video is
// made only when the user asks to download one. Nothing plays by itself, and nothing is sent to
// the LLM, so a card that is mounted again has nothing to remember.
import { PLUGIN_RUNTIME_KEY } from "gui-chat-protocol/vue";
import type { PerformanceData } from "avatarscript";
import { avatarRect, captionCss, createPerformer, resolveSubtitles, type Performer } from "avatarscript/player";
import { computed, inject, onBeforeUnmount, onMounted, ref } from "vue";
import { parseVideoReply, VIDEO_REQUEST } from "../requests.ts";
import { fetchAvatar } from "./avatar-cache.ts";
import { captionIndexAt, downloadName, formatTime, percentRect } from "./layout.ts";

const props = defineProps<{ data: PerformanceData }>();

/** The stage is never taller than this share of the window. */
const STAGE_MAX_HEIGHT = "70vh";

/** The host's runtime: how this view reaches the tool's server side. */
const runtime = inject(PLUGIN_RUNTIME_KEY, null);
const canvas = ref<HTMLCanvasElement | null>(null);
const audio = ref<HTMLAudioElement | null>(null);
const now = ref(0);
const playing = ref(false);
/** What the stage says instead of the avatar: while it loads, or why it cannot be shown. */
const status = ref<string | undefined>("Loading the avatar…");
/** Where the avatar goes on the stage, once its rig is known. */
const place = ref<Record<"left" | "top" | "width" | "height", string> | undefined>(undefined);
const captions = computed(() => props.data.score.captions);
const current = computed(() => captionIndexAt(captions.value, now.value));
/**
 * The stage has the video's aspect at any size: as wide as the card, or narrower when that would
 * make it taller than most of the window, so the avatar's place and the captions' size stay those
 * of the video.
 */
const stageStyle = computed(() => ({
  aspectRatio: `${props.data.width} / ${props.data.height}`,
  width: `min(100%, calc(${STAGE_MAX_HEIGHT} * ${props.data.width} / ${props.data.height}))`,
  background: props.data.score.view.background,
}));

/** The subtitles as the video draws them: the score's style, or the defaults; null when they are off. */
const subtitles = computed(() => resolveSubtitles(props.data.score.subtitles, props.data.subtitles));
const captionStyle = computed(() => (subtitles.value === null ? undefined : captionCss(subtitles.value, props.data.height)));
const caption = computed(() => (subtitles.value === null ? undefined : captions.value[current.value]?.text));

let disposed = false;
let frame = 0;
let destroy: (() => void) | undefined;
/** The avatar's performer, once the avatar is there; without it (still loading, or it failed) only the clock runs. */
let performer: Performer | undefined;

/**
 * The clock: every animation frame it reads the audio's time, which moves the slider, the marked
 * line and the subtitles, and hands it to the avatar when there is one. It runs whether or not
 * the avatar could be shown, so a card whose avatar failed still follows its sound.
 */
function runClock(): void {
  let last = performance.now();
  const tick = (time: number): void => {
    const player = audio.value;
    const t = player?.currentTime ?? 0;
    performer?.update(t, (time - last) / 1000, player !== null && !player.paused && !player.ended);
    last = time;
    now.value = t;
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
}

async function start(): Promise<void> {
  if (runtime === null) throw new Error("this host gives the view no way to fetch the avatar");
  const [{ createMeshAvatar, parseRig }, avatar] = await Promise.all([import("mesh-avatar"), fetchAvatar(runtime, props.data)]);
  const element = canvas.value;
  if (disposed || element === null) return;
  const rect = avatarRect(avatar.rig, props.data.width, props.data.height, props.data.score.view);
  place.value = percentRect(rect, props.data.width, props.data.height);
  const mesh = await createMeshAvatar(element, { rig: parseRig(avatar.rig), assets: avatar.assets, manual: true, padTop: rect.padTop });
  if (disposed) {
    mesh.destroy();
    return;
  }
  destroy = () => mesh.destroy();
  performer = createPerformer(mesh, { score: props.data.score, levels: props.data.levels });
  status.value = undefined;
}

onMounted(() => {
  runClock();
  start().catch((error: unknown) => {
    status.value = `The avatar could not be shown: ${error instanceof Error ? error.message : String(error)}. The sound still plays.`;
  });
});

onBeforeUnmount(() => {
  disposed = true;
  cancelAnimationFrame(frame);
  audio.value?.pause();
  destroy?.();
});

function toggle(): void {
  const player = audio.value;
  if (player === null) return;
  if (player.paused || player.ended) void player.play();
  else player.pause();
}

function jump(t: number): void {
  const player = audio.value;
  if (player === null) return;
  player.currentTime = t;
  now.value = t;
}

function onSeek(event: Event): void {
  if (event.target instanceof HTMLInputElement) jump(Number(event.target.value));
}

/** The video, once it was made here: a second download does not render it again. */
const video = ref<string | undefined>(undefined);
const making = ref(false);
const videoNote = ref<string | undefined>(undefined);

function save(dataUri: string): void {
  const link = document.createElement("a");
  link.href = dataUri;
  link.download = downloadName(props.data);
  link.click();
}

async function download(): Promise<void> {
  if (making.value) return;
  if (video.value !== undefined) return save(video.value);
  if (runtime === null) {
    videoNote.value = "This host gives the view no way to make the video.";
    return;
  }
  making.value = true;
  videoNote.value = `Making the video: about ${formatTime(props.data.duration)}.`;
  try {
    const reply = parseVideoReply(await runtime.dispatch({ kind: VIDEO_REQUEST, performance: props.data }));
    if (reply === undefined) throw new Error("the host did not answer with a video");
    if (reply.outcome === "failed") throw new Error(reply.message);
    video.value = reply.video;
    videoNote.value = reply.file === undefined ? undefined : `Kept as ${reply.file}.`;
    save(reply.video);
  } catch (error) {
    videoNote.value = `The video could not be made: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    making.value = false;
  }
}
</script>

<template>
  <div class="live">
    <div class="stage" :style="stageStyle">
      <canvas ref="canvas" :style="place" :class="{ hidden: place === undefined }" role="img" :aria-label="`The avatar: ${data.title}`" />
      <p v-if="status" class="status">{{ status }}</p>
      <p v-if="caption" class="caption" :style="captionStyle">{{ caption }}</p>
    </div>
    <audio ref="audio" :src="data.audio" preload="auto" @play="playing = true" @pause="playing = false" @ended="playing = false" />
    <div class="controls">
      <button type="button" class="play" :aria-label="playing ? 'Pause' : 'Play'" @click="toggle">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="playing ? 'M7 5h4v14H7zM13 5h4v14h-4z' : 'M8 5v14l11-7z'" /></svg>
      </button>
      <input type="range" min="0" :max="data.duration" step="0.01" :value="now" aria-label="Position" @input="onSeek" />
      <span class="time">{{ formatTime(now) }} / {{ formatTime(data.duration) }}</span>
    </div>
    <ol v-if="captions.length > 0" class="words" aria-label="Words">
      <li v-for="(line, i) in captions" :key="i" :class="{ current: i === current }">
        <button type="button" :aria-current="i === current ? 'true' : undefined" @click="jump(line.start)">
          <span class="at">{{ formatTime(line.start) }}</span>
          <span>{{ line.text }}</span>
        </button>
      </li>
    </ol>
    <footer>
      <span v-if="videoNote" class="note" role="status">{{ videoNote }}</span>
      <button type="button" class="download" :disabled="making" @click="download">{{ making ? "Making the video…" : "Download MP4" }}</button>
    </footer>
  </div>
</template>
