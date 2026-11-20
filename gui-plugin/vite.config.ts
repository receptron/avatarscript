import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";
import { defineConfig } from "vite";

// Two entries: index (Node, the tool) and vue (browser, the view). The library, the protocol and
// Vue stay external, so the host provides them; so does the mesh engine (mesh-avatar), which the
// view loads only when it shows an avatar. The view uses the library's browser entry
// (avatarscript/player), never its index, which needs Node.
export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: { index: resolve(import.meta.dirname, "src/index.ts"), vue: resolve(import.meta.dirname, "src/vue/index.ts") },
      formats: ["es"],
      fileName: (_format, entry) => `${entry}.js`,
    },
    rollupOptions: {
      external: ["vue", /^avatarscript(\/|$)/, "mesh-avatar", /^gui-chat-protocol(\/|$)/, /^node:/],
      output: { assetFileNames: "style.[ext]" },
    },
    cssCodeSplit: false,
  },
});
