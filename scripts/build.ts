// yarn build: compiles src/ to dist/ and bundles the mesh avatar engine (the mesh-avatar
// package) into dist/engine/ with its license, so the package runs without it or esbuild.
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parseJson } from "../src/json.ts";
import { bundleEngine, packageEngine } from "../src/engine.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
await rm(dist, { recursive: true, force: true });
execFileSync("npx", ["tsc", "-p", "tsconfig.build.json"], { cwd: root, stdio: "inherit" });

const engine = packageEngine();
const { name, version } = parseJson(
  z.looseObject({ name: z.string(), version: z.string() }),
  await readFile(join(engine.root, "package.json"), "utf8"),
  "mesh-avatar package.json",
);
const source = { package: name, version, repository: "https://github.com/shinshin86/mesh-avatar-studio" };
await mkdir(join(dist, "engine"), { recursive: true });
const banner = `/*! Mesh avatar engine: ${name}@${version} (${source.repository}).\n * MIT License, see LICENSE.mesh-avatar in this folder. */\n`;
await writeFile(join(dist, "engine/mesh-engine.js"), banner + (await bundleEngine(engine)));
await copyFile(join(engine.root, "LICENSE"), join(dist, "engine/LICENSE.mesh-avatar"));
await writeFile(join(dist, "engine/source.json"), JSON.stringify(source, null, 2) + "\n");
console.log(`built dist/ with the mesh engine ${name}@${version}`);
