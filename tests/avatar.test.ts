import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadAvatar } from "../src/avatar.ts";

// Serves avatars/ani over HTTP, with per-test overrides, and counts requests per path.
const ANI = resolve(import.meta.dirname, "../avatars/ani");
const requests: string[] = [];
const queries: string[] = [];
const overrides = new Map<string, string | null>();
let server: Server;
let base: string;
let cacheDir: string;

beforeAll(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "avatarscript-avatars-"));
  server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
    requests.push(path);
    queries.push((req.url ?? "").split("?")[1] ?? "");
    const override = overrides.get(path);
    if (override === null) return void res.writeHead(404).end();
    if (override !== undefined) return void res.end(override);
    if (!path.startsWith("/ani/")) return void res.writeHead(404).end();
    readFile(join(ANI, path.slice("/ani/".length))).then(
      (body) => res.end(body),
      () => res.writeHead(404).end(),
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((done) => server.close(done));
  await rm(cacheDir, { recursive: true, force: true });
});

const fresh = () => {
  requests.length = 0;
  queries.length = 0;
  overrides.clear();
};

describe("loadAvatar", () => {
  it("loads the bundled sample from disk", async () => {
    const avatar = await loadAvatar(ANI);
    expect(avatar.manifest.name).toBe("ani");
    expect(Object.keys(avatar.assets)).toEqual(
      expect.arrayContaining(["layers.json", "base.png", "hairmask.png", "sprites/sprites.json", "sprites/mouth_a.png"]),
    );
    expect(avatar.drawnMouths).toBe(true);
  });

  it("loads the same avatar from a URL, then reuses the cached images", async () => {
    fresh();
    const local = await loadAvatar(ANI);
    const remote = await loadAvatar(`${base}/ani/`, { cacheDir });
    expect(remote.assets).toEqual(local.assets);
    expect(remote.rig).toEqual(local.rig);
    expect(requests.filter((p) => p.endsWith(".png")).length).toBeGreaterThan(10);

    fresh();
    const again = await loadAvatar(`${base}/ani/avatar.json`, { cacheDir });
    expect(again.assets).toEqual(local.assets);
    // the small listings are fetched each time; the images come from the cache
    expect(requests.filter((p) => p.endsWith(".png"))).toEqual([]);
    expect(requests).toContain("/ani/built/layers.json");
  });

  it("fetches images again when the avatar is rebuilt", async () => {
    fresh();
    const layers = JSON.parse(await readFile(join(ANI, "built/layers.json"), "utf8")) as { build: string };
    overrides.set("/ani/built/layers.json", JSON.stringify({ ...layers, build: "rebuilt" }));
    await loadAvatar(`${base}/ani`, { cacheDir });
    expect(requests).toContain("/ani/built/base.png");
  });

  it("loads a mesh-avatar-studio project folder (no avatar.json) from a URL", async () => {
    fresh();
    overrides.set("/ani/avatar.json", null);
    const avatar = await loadAvatar(`${base}/ani`, { cacheDir });
    expect(avatar.manifest.name).toBe("ani");
    expect(avatar.drawnMouths).toBe(true);
  });

  it("keeps the URL's query (a version, a signature) on every request", async () => {
    fresh();
    const local = await loadAvatar(ANI);
    const viaManifest = await loadAvatar(`${base}/ani/avatar.json?v=1`, { cacheDir: join(cacheDir, "query") });
    expect(viaManifest.assets).toEqual(local.assets);
    expect(new Set(queries)).toEqual(new Set(["v=1"]));
    fresh();
    await loadAvatar(`${base}/ani?v=2`, { cacheDir: join(cacheDir, "query") });
    expect(requests).toContain("/ani/avatar.json");
    // another version is another cache entry: its images are fetched, not taken from v=1
    expect(requests).toContain("/ani/built/base.png");
    expect(new Set(queries)).toEqual(new Set(["v=2"]));
  });

  it("keeps an asset's own query", async () => {
    fresh();
    const manifest = JSON.parse(await readFile(join(ANI, "avatar.json"), "utf8")) as { assets: Record<string, string> };
    overrides.set("/ani/avatar.json", JSON.stringify({ ...manifest, assets: { ...manifest.assets, rig: "rig.json?token=abc" } }));
    overrides.set("/ani/rig.json", await readFile(join(ANI, "rig.json"), "utf8"));
    await loadAvatar(`${base}/ani/?v=3`, { cacheDir });
    expect(queries[requests.indexOf("/ani/rig.json")]).toBe("token=abc");
    expect(queries[requests.indexOf("/ani/built/layers.json")]).toBe("v=3");
  });

  it("refuses files outside the avatar's folder", async () => {
    fresh();
    const manifest = JSON.parse(await readFile(join(ANI, "avatar.json"), "utf8")) as Record<string, unknown>;
    overrides.set("/ani/avatar.json", JSON.stringify({ ...manifest, root: "../other/" }));
    await expect(loadAvatar(`${base}/ani/`, { cacheDir })).rejects.toThrow("root escapes");
    overrides.set("/ani/avatar.json", JSON.stringify({ ...manifest, assets: { rig: "https://example.com/rig.json", layers: "built/layers.json" } }));
    await expect(loadAvatar(`${base}/ani/`, { cacheDir })).rejects.toThrow("escapes the avatar folder: rig");
    expect(requests.some((p) => p.includes("other") || p.includes("example"))).toBe(false);
  });

  it("checks what it downloads", async () => {
    fresh();
    overrides.set("/ani/built/base.png", "<html>not an image</html>");
    await expect(loadAvatar(`${base}/ani/`, { cacheDir: join(cacheDir, "empty") })).rejects.toThrow("not a PNG");
  });

  it("rejects what is not an avatar or not http(s)", async () => {
    fresh();
    await expect(loadAvatar(`${base}/nothing/`, { cacheDir })).rejects.toThrow("is not an avatar");
    await expect(loadAvatar("ftp://example.com/ani/", { cacheDir })).rejects.toThrow("only http and https");
  });
});
