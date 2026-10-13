import { join } from "node:path";

/** `--script example:<name>` reads the sample script `examples/<name>.avs` shipped with the package. */
export const EXAMPLE_PREFIX = "example:";
const EXAMPLE_EXTENSION = ".avs";

/** The bundled example names in a listing of the examples folder. */
export function exampleNames(files: readonly string[]): string[] {
  return files
    .filter((file) => file.endsWith(EXAMPLE_EXTENSION) && file.length > EXAMPLE_EXTENSION.length)
    .map((file) => file.slice(0, -EXAMPLE_EXTENSION.length))
    .sort((a, b) => a.localeCompare(b));
}

/** The file a `--script` value refers to: a bundled example's path, or the value itself. */
export function scriptSource(arg: string, examplesDir: string, names: readonly string[]): string {
  if (!arg.startsWith(EXAMPLE_PREFIX)) return arg;
  const name = arg.slice(EXAMPLE_PREFIX.length);
  if (!names.includes(name)) {
    const known = names.length ? names.map((n) => EXAMPLE_PREFIX + n).join(", ") : "none are bundled";
    throw new Error(`unknown example "${name}" (examples: ${known})`);
  }
  return join(examplesDir, name + EXAMPLE_EXTENSION);
}
