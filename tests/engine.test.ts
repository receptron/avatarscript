import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkoutEngine } from "../src/engine.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

/** A fake mesh-avatar-studio checkout with the given files. */
async function checkout(...files: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "avatarscript-engine-"));
  dirs.push(root);
  for (const f of files) {
    await mkdir(join(root, f, ".."), { recursive: true });
    await writeFile(join(root, f), "");
  }
  return root;
}

describe("checkoutEngine", () => {
  it("bundles the runtime package of a current checkout", async () => {
    const root = await checkout("packages/runtime/src/index.ts", "src/engine/index.ts");
    expect(await checkoutEngine(root)).toEqual({ entry: join(root, "packages/runtime/src/index.ts"), root: join(root, "packages/runtime") });
  });

  it("accepts a checkout from before the runtime package (src/engine/)", async () => {
    const root = await checkout("src/engine/index.ts");
    expect(await checkoutEngine(root)).toEqual({ entry: join(root, "src/engine/index.ts"), root });
  });

  it("names both layouts when neither is there", async () => {
    const root = await checkout("README.md");
    await expect(checkoutEngine(root)).rejects.toThrow(/packages\/runtime\/src\/index\.ts or .*src\/engine\/index\.ts/);
  });
});
