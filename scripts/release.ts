// yarn release: publishes to npm whichever of the two packages has a version npm does not have yet,
// avatarscript first, then @gui-chat-plugin/avatarscript (its peer needs the new library), and
// tags the release. Both packages always carry the same version, and the plugin's peer is
// ^<that version>; this refuses to publish when they do not.
//
// Runs only from a clean main that matches origin/main, so what is published is what is merged.
// `yarn release --dry-run` checks everything and says what it would publish, without publishing.
// npm asks for a one-time password itself when the account needs one. It publishes to the
// registry npm is configured with (`npm config get registry`), not yarn's.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const root = join(import.meta.dirname, "..");
const pluginDir = join(root, "gui-plugin");

// yarn 1 runs scripts with npm_config_registry set to its own mirror (registry.yarnpkg.com), which
// npm would then publish to, where nobody is logged in. npm's own configuration decides instead.
const npmEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_registry"));
const dryRun = process.argv.includes("--dry-run");

const Manifest = z.object({
  name: z.string(),
  version: z.string(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
});

function fail(message: string): never {
  console.error(`release: ${message}`);
  process.exit(1);
}

/** Runs a command and returns its stdout; fails the release when it fails. */
function run(command: string, args: string[], cwd = root): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed:\n${result.stderr.trim()}`);
  return result.stdout.trim();
}

/** Runs a command with the terminal attached (npm publish may ask for a one-time password). */
function runAttached(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: npmEnv });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed in ${cwd}`);
}

/** Whether npm has this exact version of the package. */
function published(name: string, version: string): boolean {
  const result = spawnSync("npm", ["view", `${name}@${version}`, "version"], { cwd: root, encoding: "utf8", env: npmEnv });
  if (result.status === 0) return result.stdout.trim() === version;
  if (result.stderr.includes("E404")) return false;
  return fail(`cannot ask npm about ${name}@${version}:\n${result.stderr.trim()}`);
}

const manifest = (dir: string) => Manifest.parse(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")));

// What is published is what is merged.
const branch = run("git", ["branch", "--show-current"]);
if (branch !== "main") fail(`run it on main (this is ${branch || "a detached HEAD"})`);
const dirty = run("git", ["status", "--porcelain"]);
if (dirty !== "") fail(`the working tree is not clean:\n${dirty}`);
run("git", ["fetch", "--quiet", "origin", "main"]);
if (run("git", ["rev-parse", "HEAD"]) !== run("git", ["rev-parse", "origin/main"])) fail("main is not the same as origin/main: pull (or push) first");

// One version for both, and the plugin's peer on it.
const library = { dir: root, ...manifest(root) };
const plugin = { dir: pluginDir, ...manifest(pluginDir) };
if (plugin.version !== library.version) fail(`${library.name} is ${library.version} but ${plugin.name} is ${plugin.version}: give both the same version`);
const peer = plugin.peerDependencies?.[library.name];
if (peer !== `^${library.version}`) fail(`${plugin.name}'s peer ${library.name} is ${peer ?? "missing"}; it should be ^${library.version}`);

const pending = [library, plugin].filter((pkg) => !published(pkg.name, pkg.version));
if (pending.length === 0) {
  console.log(`release: ${library.name} and ${plugin.name} ${library.version} are both on npm already: nothing to publish`);
  process.exit(0);
}
const names = pending.map((pkg) => pkg.name + "@" + pkg.version);
console.log(`release: to publish: ${names.join(", ")}`);

// Each package builds itself as it is packed (prepack). The plugin's build needs its own
// dependencies installed, and the library's dist/ for the types its declarations import: that is
// built here, since the library's own prepack does not run when only the plugin is left to publish.
if (pending.includes(plugin)) {
  if (!existsSync(join(pluginDir, "node_modules"))) fail("gui-plugin has no node_modules: run `yarn install` in gui-plugin first");
  runAttached("yarn", ["build"], root);
}

// The plugin is a scoped package, public by its publishConfig; without it npm would refuse the first publish.
const publish = dryRun ? ["publish", "--dry-run"] : ["publish"];
for (const pkg of pending) {
  runAttached("npm", publish, pkg.dir);
  if (!dryRun) console.log(`release: published ${pkg.name}@${pkg.version}`);
}
if (dryRun) {
  console.log("release: dry run, nothing published");
  process.exit(0);
}

// Tags here are named after the library ("avatarscript@0.5.0").
const tag = `${library.name}@${library.version}`;
if (run("git", ["tag", "--list", tag]) === "") {
  run("git", ["tag", "-a", tag, "-m", `${library.name} and ${plugin.name} ${library.version}`]);
  run("git", ["push", "--quiet", "origin", tag]);
  console.log(`release: tagged ${tag} and pushed the tag`);
}
