// Avatar packages. A folder with `avatar.json`, or a mesh-avatar-studio project folder
// (rig.json + built/), which gets a default manifest.
import { readFile, stat } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';

export interface AvatarManifest {
  format: 'avatarscript-avatar/1';
  name: string;
  runtime: 'mesh-avatar/1';
  /** folder the asset paths are relative to, relative to the manifest */
  root?: string;
  assets: { rig: string; layers: string; sprites?: string };
  voice?: { elevenlabs?: { voiceId?: string; model?: string } };
  license?: { attribution?: string; terms?: string };
}

export interface Avatar {
  manifest: AvatarManifest;
  rig: { image: { width: number; height: number } } & Record<string, unknown>;
  /** asset name (as the mesh engine asks for it) → data URL */
  assets: Record<string, string>;
  /** drawn vowel mouths available */
  drawnMouths: boolean;
}

const exists = (p: string) => stat(p).then(() => true, () => false);

export async function loadAvatar(dir: string): Promise<Avatar> {
  const folder = resolve(dir);
  let manifest: AvatarManifest;
  if (await exists(resolve(folder, 'avatar.json'))) {
    manifest = JSON.parse(await readFile(resolve(folder, 'avatar.json'), 'utf8'));
    if (manifest.format !== 'avatarscript-avatar/1') throw new Error(`${dir}/avatar.json: unsupported format "${manifest.format}"`);
  } else if (await exists(resolve(folder, 'rig.json')) && await exists(resolve(folder, 'built/layers.json'))) {
    manifest = {
      format: 'avatarscript-avatar/1', name: basename(folder), runtime: 'mesh-avatar/1',
      assets: { rig: 'rig.json', layers: 'built/layers.json', sprites: 'built/sprites/sprites.json' },
    };
  } else {
    throw new Error(`${dir} is not an avatar: expected avatar.json, or rig.json and built/layers.json`);
  }
  const root = resolve(folder, manifest.root ?? '.');
  const rig = JSON.parse(await readFile(resolve(root, manifest.assets.rig), 'utf8'));
  const layersPath = resolve(root, manifest.assets.layers);
  const built = resolve(layersPath, '..');

  const assets: Record<string, string> = {};
  const add = async (name: string, path: string) => {
    if (relative(root, path).startsWith('..')) throw new Error(`asset escapes the avatar folder: ${name}`);
    const type = name.endsWith('.png') ? 'image/png' : 'application/json';
    assets[name] = `data:${type};base64,${(await readFile(path)).toString('base64')}`;
  };
  await add('layers.json', layersPath);
  const layers = JSON.parse(await readFile(layersPath, 'utf8'));
  await Promise.all(['base', 'hairmask', ...Object.keys(layers.layers)].map(n => add(`${n}.png`, resolve(built, `${n}.png`))));

  let drawnMouths = false;
  const spritesPath = manifest.assets.sprites && resolve(root, manifest.assets.sprites);
  if (spritesPath && await exists(spritesPath)) {
    await add('sprites/sprites.json', spritesPath);
    const sprites = JSON.parse(await readFile(spritesPath, 'utf8'));
    const names = Object.keys(sprites.layers);
    await Promise.all(names.map(n => add(`sprites/${n}.png`, resolve(spritesPath, '..', `${n}.png`))));
    drawnMouths = names.some(n => n.startsWith('mouth_'));
  }
  return { manifest, rig, assets, drawnMouths };
}
