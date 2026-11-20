<script setup lang="ts">
// The compact card in the chat history: what the video is, its title and its length.
import type { ToolResultComplete } from "gui-chat-protocol";
import type { VideoData } from "avatarscript";
import { computed } from "vue";
import { formatTime, KIND_LABELS } from "./layout.ts";

const props = defineProps<{ result: ToolResultComplete<VideoData> }>();
const data = computed(() => props.result.data);
</script>

<template>
  <div v-if="data" class="preview">
    <span class="kind">{{ KIND_LABELS[data.kind] }}</span>
    <span class="title">{{ data.title }}</span>
    <span class="length">{{ formatTime(data.duration) }}</span>
  </div>
</template>

<style scoped>
.preview {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-family: system-ui, sans-serif;
  font-size: 0.85rem;
  color: #1d2330;
}
@media (prefers-color-scheme: dark) {
  .preview {
    color: #e6e9ef;
  }
}
.kind {
  padding: 1px 6px;
  border: 1px solid currentColor;
  border-radius: 999px;
  font-size: 0.75rem;
  opacity: 0.75;
}
.title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.length {
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
}
</style>
