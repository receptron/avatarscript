// Avatar packages. A folder with `avatar.json`, or a mesh-avatar-studio project folder
// (rig.json + built/), which gets a default manifest. Either can be on disk or at an http(s) URL;
// a package names every file it needs, so it can be fetched file by file.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
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

export interface LoadAvatarOptions {
  /** where avatars loaded from a URL are cached; default $AVATARSCRIPT_AVATAR_DIR or ~/.cache/avatarscript/avatars */
  cacheDir?: string;
}

/** Largest file accepted from a URL. An avatar's biggest file, the base layer, is a few MB. */
const MAX_DOWNLOAD = 32 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const avatarCacheDir = () => process.env.AVATARSCRIPT_AVATAR_DIR ?? join(homedir(), ".cache", "avatarscript", "avatars");

const isUrl = (location: string) => /^[a-z][a-z\d+.-]*:\/\//i.test(location);
const hash = (text: string | Buffer) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** Where a package lives: files are addressed by absolute path or URL, resolved like paths. */
interface Store {
  /** the package folder, as a location ending in a separator */
  folder: string;
  /** `path` relative to `from`: inside it when `from` ends in a separator, else beside it (as URLs resolve) */
  resolve(from: string, path: string): string;
  /** whether `location` is inside folder `root` */
  contains(root: string, location: string): boolean;
  /** a file's bytes, or undefined when it does not exist; `cacheKey` lets a URL store reuse a download */
  read(location: string, kind: "json" | "png", cacheKey?: string): Promise<Buffer | undefined>;
}

function diskStore(dir: string): Store {
  const readOrUndefined = (path: string) =>
    readFile(path).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    });
  return {
    folder: resolve(dir) + sep,
    resolve: (from, path) => resolve(from.endsWith(sep) ? from : dirname(from), path),
    contains: (root, location) => !relative(root, location).startsWith(".."),
    read: (location) => readOrUndefined(location),
  };
}

function urlStore(url: string, cacheDir: string): Store {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error(`${url}: only http and https avatar URLs are supported`);
  // locations are kept without the query; the source's query (a version, a signature) goes with every request
  const folderUrl = new URL(parsed);
  folderUrl.search = folderUrl.hash = "";
  folderUrl.pathname = parsed.pathname.endsWith("/avatar.json") ? parsed.pathname.slice(0, -"avatar.json".length) : parsed.pathname.replace(/\/?$/, "/");
  const folder = folderUrl.href;
  const download = async (location: string, kind: "json" | "png") => {
    const request = Object.assign(new URL(location), { search: parsed.search });
    const response = await fetch(request, { signal: AbortSignal.timeout(120_000) });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`${location}: HTTP ${response.status}`);
    if (Number(response.headers.get("content-length") ?? 0) > MAX_DOWNLOAD) throw new Error(`${location}: larger than ${MAX_DOWNLOAD} bytes`);
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > MAX_DOWNLOAD) throw new Error(`${location}: larger than ${MAX_DOWNLOAD} bytes`);
    if (kind === "png" && !body.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`${location}: not a PNG`);
    return body;
  };
  return {
    folder,
    resolve: (from, path) => new URL(path, from).href,
    contains: (root, location) => location.startsWith(root.replace(/\/?$/, "/")),
    async read(location, kind, cacheKey) {
      if (!cacheKey) return download(location, kind);
      // cached per package and per listing that names the file, so a rebuilt avatar is fetched again
      const file = join(cacheDir, hash(folder), cacheKey, hash(location) + "." + kind);
      const cached = await readFile(file).catch(() => undefined);
      if (cached) return cached;
      const body = await download(location, kind);
      if (body) {
        await mkdir(dirname(file), { recursive: true });
        const partial = `${file}.${process.pid}.partial`;
        await writeFile(partial, body);
        await rename(partial, file);
      }
      return body;
    },
  };
}

/**
 * Loads an avatar package from a folder or an http(s) URL (the package folder, or its avatar.json).
 * Files from a URL are checked (size, PNG signature, inside the package folder) and their images
 * cached on disk; the small JSON files are fetched each time, so an updated avatar is picked up.
 */
export async function loadAvatar(location: string, options: LoadAvatarOptions = {}): Promise<Avatar> {
  const store = isUrl(location) ? urlStore(location, options.cacheDir ?? avatarCacheDir()) : diskStore(location);
  const at = (path: string) => store.resolve(store.folder, path);
  const text = async (where: string) => {
    const body = await store.read(where, "json");
    if (!body) throw new Error(`${where} is missing`);
    return body.toString("utf8");
  };

  let manifest: AvatarManifest;
  const manifestBody = await store.read(at("avatar.json"), "json");
  if (manifestBody) {
    manifest = parseJson(AvatarManifestSchema, manifestBody.toString("utf8"), at("avatar.json"));
  } else if ((await store.read(at("rig.json"), "json")) && (await store.read(at("built/layers.json"), "json"))) {
    manifest = {
      format: "avatarscript-avatar/1",
      name: basename(store.folder),
      runtime: "mesh-avatar/1",
      assets: { rig: "rig.json", layers: "built/layers.json", sprites: "built/sprites/sprites.json" },
    };
  } else {
    throw new Error(`${location} is not an avatar: expected avatar.json, or rig.json and built/layers.json`);
  }
  const root = at(manifest.root ?? ".");
  // a remote package may only name files inside its own folder
  if (isUrl(location) && !store.contains(store.folder, root)) throw new Error(`avatar root escapes the avatar folder: ${manifest.root}`);
  const inside = (name: string, path: string) => {
    const where = store.resolve(root.replace(/[/\\]?$/, isUrl(location) ? "/" : sep), path);
    if (!store.contains(root, where)) throw new Error(`asset escapes the avatar folder: ${name}`);
    return where;
  };
  const rigPath = inside("rig", manifest.assets.rig);
  const rig = parseJson(RigSchema, await text(rigPath), rigPath);

  const assets: Record<string, string> = {};
  const add = async (name: string, where: string, cacheKey?: string) => {
    const png = name.endsWith(".png");
    const body = await store.read(where, png ? "png" : "json", cacheKey);
    if (!body) throw new Error(`${where} is missing`);
    assets[name] = `data:${png ? "image/png" : "application/json"};base64,${body.toString("base64")}`;
  };
  const layersPath = inside("layers.json", manifest.assets.layers);
  const layersText = await text(layersPath);
  const layers = parseJson(LayerListSchema, layersText, layersPath);
  assets["layers.json"] = `data:application/json;base64,${Buffer.from(layersText).toString("base64")}`;
  const layerKey = hash(layersText);
  await Promise.all(
    ["base", "hairmask", ...Object.keys(layers.layers)].map((n) => add(`${n}.png`, inside(`${n}.png`, store.resolve(layersPath, `${n}.png`)), layerKey)),
  );

  let drawnMouths = false;
  const spritesPath = manifest.assets.sprites && inside("sprites.json", manifest.assets.sprites);
  const spritesBody = spritesPath && (await store.read(spritesPath, "json"));
  if (spritesPath && spritesBody) {
    const spritesText = spritesBody.toString("utf8");
    assets["sprites/sprites.json"] = `data:application/json;base64,${spritesBody.toString("base64")}`;
    const sprites = parseJson(LayerListSchema, spritesText, spritesPath);
    const names = Object.keys(sprites.layers);
    const spriteKey = hash(spritesText);
    await Promise.all(names.map((n) => add(`sprites/${n}.png`, inside(`sprites/${n}.png`, store.resolve(spritesPath, `${n}.png`)), spriteKey)));
    drawnMouths = names.some((n) => n.startsWith("mouth_"));
  }
  return { manifest, rig, assets, drawnMouths };
}
