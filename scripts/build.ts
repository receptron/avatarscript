// npm run build: compiles src/ to dist/ and bundles the mesh avatar engine into
// dist/engine/ with its license, so the package runs without a mesh-avatar-studio checkout.
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleEngine, findEngineRoot } from '../src/engine.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
await rm(dist, { recursive: true, force: true });
execFileSync('npx', ['tsc', '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' });

const engineRoot = await findEngineRoot(process.argv[2]);
const git = (...args: string[]) => execFileSync('git', ['-C', engineRoot, ...args], { encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
const dirty = git('status', '--porcelain', '--', 'src/engine', 'src/rig') !== '';
const source = { repository: 'https://github.com/shinshin86/mesh-avatar-studio', commit, modified: dirty };
await mkdir(join(dist, 'engine'), { recursive: true });
const banner = `/*! Mesh avatar engine from mesh-avatar-studio (${source.repository}, ${commit.slice(0, 7)}${dirty ? ', modified' : ''}).\n * MIT License, see LICENSE.mesh-avatar-studio in this folder. */\n`;
await writeFile(join(dist, 'engine/mesh-engine.js'), banner + await bundleEngine(engineRoot));
await copyFile(join(engineRoot, 'LICENSE'), join(dist, 'engine/LICENSE.mesh-avatar-studio'));
await writeFile(join(dist, 'engine/source.json'), JSON.stringify(source, null, 2) + '\n');
console.log(`built dist/ with the mesh engine from ${engineRoot} @ ${commit.slice(0, 7)}${dirty ? ' (modified)' : ''}`);
