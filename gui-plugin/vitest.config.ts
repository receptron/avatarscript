import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Tests (and the demo page) use the library's source, not a possibly stale dist.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [{ find: /^avatarscript$/, replacement: resolve(import.meta.dirname, "../src/index.ts") }],
  },
});
