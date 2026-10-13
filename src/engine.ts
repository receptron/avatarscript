// The mesh avatar engine (the mesh-avatar package, from mesh-avatar-studio) as one script for the
// render page. Packages ship it prebuilt in dist/engine/; a source checkout bundles it from the
// mesh-avatar development dependency, or from a mesh-avatar-studio checkout when one is named.
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
/** Where `yarn build` writes the bundled engine (dist/engine/ next to dist/engine.js). */
export const BUNDLED_ENGINE = resolve(here, "engine/mesh-engine.js");
/**
 * The engine in a mesh-avatar-studio checkout: the runtime package, or the src/engine/ it lived in
 * before mesh-avatar was published (as at the commit avatarscript 0.4 bundled). `root` holds its LICENSE.
 */
const CHECKOUT_LAYOUTS = [
  { entry: "packages/runtime/src/index.ts", root: "packages/runtime" },
  { entry: "src/engine/index.ts", root: "." },
];

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

/** Where the engine is bundled from: the installed mesh-avatar package, or a checkout's runtime source. */
export interface EngineSource {
  entry: string;
  /** the folder holding the engine's LICENSE */
  root: string;
}

/** The installed mesh-avatar package (a development dependency: packages ship the engine bundled). */
export function packageEngine(): EngineSource {
  // import.meta.resolve: the package exports only an `import` condition
  const entry = fileURLToPath(import.meta.resolve("mesh-avatar"));
  return { entry, root: resolve(dirname(entry), "..") };
}

/** A mesh-avatar-studio checkout, for trying engine changes before they are published. */
export async function checkoutEngine(root: string): Promise<EngineSource> {
  for (const layout of CHECKOUT_LAYOUTS) {
    const entry = resolve(root, layout.entry);
    if (await exists(entry)) return { entry, root: resolve(root, layout.root) };
  }
  const tried = CHECKOUT_LAYOUTS.map((l) => resolve(root, l.entry)).join(" or ");
  throw new Error(`mesh engine not found at ${tried}: --engine / AVATARSCRIPT_MESH_ENGINE must name a mesh-avatar-studio checkout.`);
}

/** Bundles the engine into one script that sets `window.MeshAvatarEngine` (esbuild is a development dependency). */
export async function bundleEngine(source: EngineSource): Promise<string> {
  const { build } = await import("esbuild");
  const result = await build({
    entryPoints: [source.entry],
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
 * The engine script. A named checkout (option or AVATARSCRIPT_MESH_ENGINE) wins; otherwise the
 * bundled copy, otherwise the installed mesh-avatar package.
 */
export async function loadEngine(explicitRoot?: string): Promise<string> {
  const root = explicitRoot ?? process.env.AVATARSCRIPT_MESH_ENGINE;
  if (root) return bundleEngine(await checkoutEngine(root));
  if (await exists(BUNDLED_ENGINE)) return readFile(BUNDLED_ENGINE, "utf8");
  return bundleEngine(packageEngine());
}
