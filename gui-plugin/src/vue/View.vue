<script setup lang="ts">
// The player: the avatar's video with the browser's controls, the words it sings or says (the one
// being heard marked; click one to jump there), and a download. Nothing plays by itself, and
// nothing is sent to the LLM, so a card that is mounted again has nothing to remember.
import type { ToolResultComplete } from "gui-chat-protocol";
import type { VideoData } from "avatarscript";
import { computed, onBeforeUnmount, ref } from "vue";
import { captionIndexAt, downloadName, formatTime, KIND_LABELS } from "./layout.ts";

const props = defineProps<{ selectedResult: ToolResultComplete<VideoData> }>();
const data = computed(() => props.selectedResult.data);
const player = ref<HTMLVideoElement | null>(null);
const now = ref(0);
const current = computed(() => (data.value === undefined ? -1 : captionIndexAt(data.value.captions, now.value)));

function onTime(): void {
  now.value = player.value?.currentTime ?? 0;
}

function jump(t: number): void {
  const video = player.value;
  if (video === null) return;
  video.currentTime = t;
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
    <video
      ref="player"
      :src="data.video"
      :style="{ aspectRatio: `${data.width} / ${data.height}` }"
      controls
      playsinline
      preload="metadata"
      :aria-label="`Video of the avatar: ${data.title}`"
      @timeupdate="onTime"
      @seeked="onTime"
    />
    <ol v-if="data.captions.length > 0" class="words" aria-label="Words">
      <li v-for="(caption, i) in data.captions" :key="i" :class="{ current: i === current }">
        <button type="button" :aria-current="i === current ? 'true' : undefined" @click="jump(caption.start)">
          <span class="at">{{ formatTime(caption.start) }}</span>
          <span>{{ caption.text }}</span>
        </button>
      </li>
    </ol>
    <footer>
      <span v-if="data.file" class="file">{{ data.file }}</span>
      <a :href="data.video" :download="downloadName(data)">Download MP4</a>
    </footer>
  </div>
  <p v-else class="avatar-card empty">No video.</p>
</template>

<style scoped>
.avatar-card {
  --ink: #1d2330;
  --muted: #5b6475;
  --line: #d9dee8;
  --accent: #3f6ae0;
  --mark: #e8eefc;
  --stage: #10141c;
  box-sizing: border-box;
  height: 100%;
  overflow-y: auto;
  padding: 16px;
  font-family: system-ui, sans-serif;
  color: var(--ink);
}
@media (prefers-color-scheme: dark) {
  .avatar-card {
    --ink: #e6e9ef;
    --muted: #9aa3b5;
    --line: #333b4b;
    --accent: #8fb0ff;
    --mark: #26324d;
  }
}
header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
h2 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.meta {
  color: var(--muted);
  font-size: 0.85rem;
}
video {
  display: block;
  width: 100%;
  max-height: 70vh;
  background: var(--stage);
  border-radius: 8px;
}
.words {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
}
.words li + li {
  border-top: 1px solid var(--line);
}
.words button {
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
.words button:hover,
.words button:focus-visible {
  background: var(--mark);
}
.words button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.words li.current button {
  background: var(--mark);
  font-weight: 600;
}
.at {
  flex: none;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  font-weight: 400;
}
footer {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 12px;
  font-size: 0.85rem;
}
.file {
  margin-right: auto;
  color: var(--muted);
  overflow-wrap: anywhere;
}
footer a {
  color: var(--accent);
}
.empty {
  color: var(--muted);
}
</style>
