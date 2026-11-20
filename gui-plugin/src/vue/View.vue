<script setup lang="ts">
// The card: the avatar performing live (a performance, see Live.vue), or a video of it with the
// browser's controls (a host without live avatars, or a card an earlier version made); under
// either, the words it sings or says, the one being heard marked (click one to jump there).
// Nothing plays by itself, and nothing is sent to the LLM, so a card that is mounted again has
// nothing to remember.
//
// The card takes its text colour from the host and draws everything else from it (currentColor),
// so it reads on a light page and on a dark one whatever the system's own colour scheme is.
import type { ToolResultComplete } from "gui-chat-protocol";
import { computed, onBeforeUnmount, ref } from "vue";
import { captionIndexAt, downloadName, formatTime, isVideo, KIND_LABELS, type CardData } from "./layout.ts";
import Live from "./Live.vue";

const props = defineProps<{ selectedResult: ToolResultComplete<CardData> }>();
const data = computed(() => props.selectedResult.data);
const video = computed(() => (data.value !== undefined && isVideo(data.value) ? data.value : undefined));
const performance = computed(() => (data.value !== undefined && !isVideo(data.value) ? data.value : undefined));
const player = ref<HTMLVideoElement | null>(null);
const now = ref(0);
const current = computed(() => (video.value === undefined ? -1 : captionIndexAt(video.value.captions, now.value)));

function onTime(): void {
  now.value = player.value?.currentTime ?? 0;
}

function jump(t: number): void {
  const element = player.value;
  if (element === null) return;
  element.currentTime = t;
  now.value = t;
}

onBeforeUnmount(() => player.value?.pause());
</script>

<template>
  <div v-if="data" class="avatar-card">
    <header>
      <h2>{{ data.title }}</h2>
      <span class="meta">{{ KIND_LABELS[data.kind] }} · {{ formatTime(data.duration) }}</span>
    </header>
    <!-- Keyed by the result: another performance gets its own avatar, audio and video, not this one's. -->
    <Live v-if="performance" :key="selectedResult.uuid" :data="performance" />
    <template v-else-if="video">
      <video
        ref="player"
        :src="video.video"
        :style="{ aspectRatio: `${video.width} / ${video.height}` }"
        controls
        playsinline
        preload="metadata"
        :aria-label="`Video of the avatar: ${video.title}`"
        @timeupdate="onTime"
        @seeked="onTime"
      />
      <ol v-if="video.captions.length > 0" class="words" aria-label="Words">
        <li v-for="(caption, i) in video.captions" :key="i" :class="{ current: i === current }">
          <button type="button" :aria-current="i === current ? 'true' : undefined" @click="jump(caption.start)">
            <span class="at">{{ formatTime(caption.start) }}</span>
            <span>{{ caption.text }}</span>
          </button>
        </li>
      </ol>
      <footer>
        <span v-if="video.file" class="note">{{ video.file }}</span>
        <a class="download" :href="video.video" :download="downloadName(video)">Download MP4</a>
      </footer>
    </template>
  </div>
  <p v-else class="avatar-card empty">No avatar to show.</p>
</template>

<!-- Not scoped: Live.vue is drawn with the same rules. Every rule is under .avatar-card. -->
<style>
.avatar-card {
  /* From the host's text colour, so the card fits a light page and a dark one alike. */
  --muted: color-mix(in srgb, currentColor 65%, transparent);
  --line: color-mix(in srgb, currentColor 22%, transparent);
  --mark: color-mix(in srgb, currentColor 10%, transparent);
  /* A blue that reads on white and on a dark panel. */
  --accent: #4c78f0;
  --on-accent: #fff;
  box-sizing: border-box;
  height: 100%;
  overflow-y: auto;
  padding: 16px;
  font-family: system-ui, sans-serif;
  color: inherit;
}
.avatar-card header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.avatar-card h2 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.avatar-card .meta {
  color: var(--muted);
  font-size: 0.85rem;
}
.avatar-card video {
  display: block;
  width: 100%;
  max-height: 70vh;
  background: #10141c;
  border-radius: 8px;
}
.avatar-card .stage {
  /* A size container: captions are sized and placed in shares of the stage, as on the video. */
  container-type: size;
  position: relative;
  /* Its width (and so, by its aspect, its height) is set by Live.vue; centred when narrower than the card. */
  margin: 0 auto;
  overflow: hidden;
  border-radius: 8px;
}
.avatar-card .stage canvas {
  position: absolute;
  display: block;
}
.avatar-card .stage canvas.hidden {
  visibility: hidden;
}
/* On the stage, whose colour is the score's (light by default), not the page's. */
.avatar-card .stage .status {
  position: absolute;
  top: 45%;
  left: 0;
  right: 0;
  margin: 0;
  padding: 0 5%;
  text-align: center;
  color: #3b4252;
  font-size: 0.9rem;
}
.avatar-card .controls {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}
.avatar-card .play {
  flex: none;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--accent);
  cursor: pointer;
}
.avatar-card .play svg {
  width: 20px;
  height: 20px;
  fill: var(--on-accent);
}
.avatar-card .controls input[type="range"] {
  flex: 1;
  min-width: 0;
  accent-color: var(--accent);
}
.avatar-card .time {
  flex: none;
  color: var(--muted);
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}
.avatar-card .words {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
}
.avatar-card .words li + li {
  border-top: 1px solid var(--line);
}
.avatar-card .words button {
  display: flex;
  gap: 12px;
  width: 100%;
  padding: 8px 12px;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.avatar-card .words button:hover,
.avatar-card .words li.current button {
  background: var(--mark);
}
.avatar-card .words li.current button {
  font-weight: 600;
}
.avatar-card .at {
  flex: none;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  font-weight: 400;
}
.avatar-card footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 12px;
  font-size: 0.85rem;
}
.avatar-card .note {
  margin-right: auto;
  color: var(--muted);
  overflow-wrap: anywhere;
}
.avatar-card .download {
  padding: 6px 12px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: none;
  color: var(--accent);
  font: inherit;
  text-decoration: none;
  cursor: pointer;
}
.avatar-card .download:disabled {
  opacity: 0.6;
  cursor: progress;
}
.avatar-card .play:focus-visible,
.avatar-card .download:focus-visible,
.avatar-card .words button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.avatar-card .words button:focus-visible {
  outline-offset: -2px;
}
.avatar-card.empty {
  color: var(--muted);
}
</style>
