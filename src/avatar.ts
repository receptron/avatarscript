// Avatar packages. A folder with `avatar.json`, or a mesh-avatar-studio project folder
// (rig.json + built/), which gets a default manifest.
import { readFile, stat } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { z } from "zod";
import { parseJson } from "./json.ts";

export const AvatarManifestSchema = z.object({
  format: z.literal("avatarscript-avatar/1"),
  name: z.string(),
  runtime: z.literal("mesh-avatar/1"),
  /** folder the asset paths are relative to, relative to the manifest */
  root: z.string().optional(),
  assets: z.object({ rig: z.string(), layers: z.string(), sprites: z.string().optional() }),
  /** default voice and model per text-to-speech provider: { "elevenlabs": { "voice": "…", "model": "…" } } */
  voice: z.record(z.string(), z.object({ voice: z.string().optional(), model: z.string().optional() })).optional(),
  license: z.object({ attribution: z.string().optional(), terms: z.string().optional() }).optional(),
});
export type AvatarManifest = z.infer<typeof AvatarManifestSchema>;

/** The mesh engine validates the rig itself; only what is read here is checked, the rest is kept. */
const RigSchema = z.looseObject({ image: z.object({ width: z.number(), height: z.number() }) });
/** built/layers.json and sprites.json: layer name → bounds */
const LayerListSchema = z.looseObject({ layers: z.record(z.string(), z.unknown()) });

export interface Avatar {
  manifest: AvatarManifest;
  rig: z.infer<typeof RigSchema>;
  /** asset name (as the mesh engine asks for it) → data URL */
  assets: Record<string, string>;
  /** drawn vowel mouths available */
  drawnMouths: boolean;
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

export async function loadAvatar(dir: string): Promise<Avatar> {
  const folder = resolve(dir);
  let manifest: AvatarManifest;
  if (await exists(resolve(folder, "avatar.json"))) {
    manifest = parseJson(AvatarManifestSchema, await readFile(resolve(folder, "avatar.json"), "utf8"), `${dir}/avatar.json`);
  } else if ((await exists(resolve(folder, "rig.json"))) && (await exists(resolve(folder, "built/layers.json")))) {
    manifest = {
      format: "avatarscript-avatar/1",
      name: basename(folder),
      runtime: "mesh-avatar/1",
      assets: { rig: "rig.json", layers: "built/layers.json", sprites: "built/sprites/sprites.json" },
    };
  } else {
    throw new Error(`${dir} is not an avatar: expected avatar.json, or rig.json and built/layers.json`);
  }
  const root = resolve(folder, manifest.root ?? ".");
  const rigPath = resolve(root, manifest.assets.rig);
  const rig = parseJson(RigSchema, await readFile(rigPath, "utf8"), rigPath);
  const layersPath = resolve(root, manifest.assets.layers);
  const built = resolve(layersPath, "..");

  const assets: Record<string, string> = {};
  const add = async (name: string, path: string) => {
    if (relative(root, path).startsWith("..")) throw new Error(`asset escapes the avatar folder: ${name}`);
    const type = name.endsWith(".png") ? "image/png" : "application/json";
    assets[name] = `data:${type};base64,${(await readFile(path)).toString("base64")}`;
  };
  await add("layers.json", layersPath);
  const layers = parseJson(LayerListSchema, await readFile(layersPath, "utf8"), layersPath);
  await Promise.all(["base", "hairmask", ...Object.keys(layers.layers)].map((n) => add(`${n}.png`, resolve(built, `${n}.png`))));

  let drawnMouths = false;
  const spritesPath = manifest.assets.sprites && resolve(root, manifest.assets.sprites);
  if (spritesPath && (await exists(spritesPath))) {
    await add("sprites/sprites.json", spritesPath);
    const sprites = parseJson(LayerListSchema, await readFile(spritesPath, "utf8"), spritesPath);
    const names = Object.keys(sprites.layers);
    await Promise.all(names.map((n) => add(`sprites/${n}.png`, resolve(spritesPath, "..", `${n}.png`))));
    drawnMouths = names.some((n) => n.startsWith("mouth_"));
  }
  return { manifest, rig, assets, drawnMouths };
}
