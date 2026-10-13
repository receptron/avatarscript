import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exampleNames, scriptSource } from "../src/examples.ts";

describe("exampleNames", () => {
  it("lists the .avs files by name, sorted, and skips everything else", () => {
    const files = ["subtitles-ja.avs", "make-video.ts", "hello-en.avs", "hello-ja.avs", "notes.avs.bak", ".avs"];
    expect(exampleNames(files)).toEqual(["hello-en", "hello-ja", "subtitles-ja"]);
  });

  it("is empty for an empty folder", () => {
    expect(exampleNames([])).toEqual([]);
  });
});

describe("scriptSource", () => {
  const names = ["hello-en", "hello-ja"];

  it("maps example:<name> to the bundled file", () => {
    expect(scriptSource("example:hello-ja", "/pkg/examples", names)).toBe(join("/pkg/examples", "hello-ja.avs"));
  });

  it("passes any other value through unchanged", () => {
    for (const arg of ["story.avs", "examples/hello-ja.avs", "/abs/notes.txt", "hello-ja", "Example:hello-ja"]) {
      expect(scriptSource(arg, "/pkg/examples", names)).toBe(arg);
    }
  });

  it("rejects an unknown, empty or path-like name and lists the bundled ones", () => {
    for (const arg of ["example:nope", "example:", "example:../package", "example:hello-ja.avs"]) {
      expect(() => scriptSource(arg, "/pkg/examples", names)).toThrow(/examples: example:hello-en, example:hello-ja/);
    }
  });

  it("says when nothing is bundled", () => {
    expect(() => scriptSource("example:hello-ja", "/pkg/examples", [])).toThrow(/none are bundled/);
  });
});
