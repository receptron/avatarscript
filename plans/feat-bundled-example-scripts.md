# Bundled example scripts (`--script example:<name>`)

Issue: #7

## Problem

`npx avatarscript make --avatar avatars/ani --script examples/hello-ja.avs ...` (the README's first
example) fails inside a clone (npx resolves to the project itself, which has no `.bin` entry) and
outside one (the relative paths are not in the npm package). Nothing lets a user try the CLI with
npx alone.

## Change

- `package.json` `files`: add `examples/*.avs`, so the sample scripts ship with the package.
- `src/examples.ts` (pure, no fs): `exampleNames(files)` lists bundled names from a directory
  listing; `scriptSource(arg, examplesDir, names)` maps a `--script` value to the file to read —
  `example:<name>` → `<examplesDir>/<name>.avs`, anything else unchanged; an unknown name throws
  with the list.
- `src/cli.ts`: read the `examples/` folder next to `dist/` (or `src/`), route `--script` through
  `scriptSource`, list the examples in `--help`, and record `example:<name>` (not a path into the
  npx cache) as the score's script provenance.
- README: the first command-line example becomes npx-only (avatar URL + `example:hello-ja`), followed
  by a prominent note that `npx avatarscript` fails inside a clone, even after `npm run build`, and
  the three commands that work there instead.

## Not in scope

A default `--avatar`; fetching scripts from URLs (see the issue for why).

## Verification

Unit tests for `src/examples.ts`; `scripts/smoke.sh avatars/ani` extended to render
`--script example:hello-ja` from the installed tarball, so the packaging is checked, not assumed.
