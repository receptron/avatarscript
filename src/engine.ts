// The mesh avatar engine (from mesh-avatar-studio) as one script for the render page.
// Packages ship it prebuilt in dist/engine/; a source checkout bundles it from a
// mesh-avatar-studio checkout next to this repository.
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
/** Where `npm run build` writes the bundled engine (dist/engine/ next to dist/engine.js). */
export const BUNDLED_ENGINE = resolve(here, "engine/mesh-engine.js");

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

export async function findEngineRoot(explicit?: string): Promise<string> {
  const root = resolve(explicit ?? process.env.AVATARSCRIPT_MESH_ENGINE ?? resolve(here, "../../mesh-avatar-studio"));
  const entry = resolve(root, "src/engine/index.ts");
  if (!(await exists(entry))) {
    throw new Error(`mesh engine not found at ${entry}. Clone mesh-avatar-studio next to this repository, or pass --engine / set AVATARSCRIPT_MESH_ENGINE.`);
  }
  return root;
}

/** Bundles the engine from a mesh-avatar-studio checkout (esbuild is a development dependency). */
export async function bundleEngine(root: string): Promise<string> {
  const { build } = await import("esbuild");
  const result = await build({
    entryPoints: [resolve(root, "src/engine/index.ts")],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "MeshAvatarEngine",
    target: "es2022",
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

/**
 * The engine script. An explicit checkout (option or AVATARSCRIPT_MESH_ENGINE) wins; otherwise
 * the bundled copy, otherwise the checkout next to this repository.
 */
export async function loadEngine(explicitRoot?: string): Promise<string> {
  if (!explicitRoot && !process.env.AVATARSCRIPT_MESH_ENGINE && (await exists(BUNDLED_ENGINE))) {
    return readFile(BUNDLED_ENGINE, "utf8");
  }
  return bundleEngine(await findEngineRoot(explicitRoot));
}
