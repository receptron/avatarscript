# CLAUDE.md — avatarscript

Working notes for AI coding agents in this repo. What the project is and how to use it are in
**README.md**; the design and milestones are in **PLAN.md**.

## TypeScript

- **Package manager: npm** (package-lock.json). Add dependencies with `npm install` /
  `npm install --save-dev`; don't hand-edit the dependency lists in package.json.
- Run after changes: `npm run typecheck`, `npm test`, and `npm run build` when the packaging or
  the engine bundle is affected.
- **Type-checking covers the whole repo only if the tsconfig says so.** `tsconfig.json` includes
  `src`, `tests` and `scripts`. A new top-level folder of `.ts` files must be added there, or
  nothing type-checks it and nothing tells you.
- **Tests must run without API keys.** Mock external services (the TTS adapters have
  `mockTts()`); a test that calls a real API is not a unit test here.
- **Import modules at module scope in tests, never inside a test.** An `await import(...)` inside
  an `it` (or a helper it awaits) loads the module's whole graph during that test, and the first
  test to reach it is billed that time against the test timeout — it looks slow, and on a loaded
  runner it times out, though the test itself was never the slow part. Collection has no
  per-test budget. The exception is a module that must be evaluated after a non-hoisted mock
  (`vi.doMock`, `vi.resetModules`); `vi.mock` is hoisted and needs no such thing.
- **Share a type or value that two places decide from; never mirror it.** When two parts of the
  code (or the library and the CLI) depend on the same shape, constant or enum, it lives in one
  module both import — not in two copies with a "keep these in sync" comment. When the two
  genuinely differ, share the common core and keep each side's extras local, with a test that
  pins the difference.
- **Make a missing case a type error.** Write per-member tables as `Record<Union, …>` (as
  `MESH_MOUTH: Record<Viseme, MeshMouth>` does) and type a name that must refer to something real
  with that union, so adding a member without handling it fails `typecheck` instead of being
  silently skipped.
