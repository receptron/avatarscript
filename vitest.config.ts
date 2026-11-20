import { configDefaults, defineConfig } from "vitest/config";

// gui-plugin/ is its own package (Vue, its own vitest config); its tests run there.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, "gui-plugin/**"] },
});
