<script setup lang="ts">
// The compact card in the chat history: what it is, its title and its length. It takes its text
// colour from the host (whose list may be light or dark whatever the system's colour scheme is)
// and sets none of its own.
import type { ToolResultComplete } from "gui-chat-protocol";
import { computed } from "vue";
import { formatTime, KIND_LABELS, type CardData } from "./layout.ts";

const props = defineProps<{ result: ToolResultComplete<CardData> }>();
const data = computed(() => props.result.data);
</script>

<template>
  <div v-if="data" class="avatar-preview">
    <span class="kind">{{ KIND_LABELS[data.kind] }}</span>
    <span class="title">{{ data.title }}</span>
    <span class="length">{{ formatTime(data.duration) }}</span>
  </div>
</template>

<style scoped>
.avatar-preview {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-family: system-ui, sans-serif;
  font-size: 0.85rem;
  color: inherit;
}
.kind {
  flex: none;
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
  flex: none;
  opacity: 0.65;
  font-variant-numeric: tabular-nums;
}
</style>
