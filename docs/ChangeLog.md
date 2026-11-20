# ChangeLog

## 0.6.0 (unreleased)

- **An avatar that sings a JingleScript song**: `compileSong` turns a JingleScript timing map
  (`jinglescript-timing/1`) into a score whose mouth follows the lyric syllables, and
  `avatarscript sing --audio … --timing …` makes the video. No speech is synthesized or aligned,
  and JingleScript is not a dependency.
- **A tool for LLMs**: `manage()` (`manageAvatarScript`: `sing`, `speak`, `getGuide`), with its
  zod input schema and JSON Schema.
- **GUI Chat Protocol plugin**: `gui-plugin/`, published as `@gui-chat-plugin/avatarscript`, carries
  the tool and shows the video in a player.

## 0.5.0 (2026-10-14)

- **Bundled example scripts** (#8, fixes #7): the sample scripts `examples/*.avs` now ship in the
  package, and `--script example:<name>` reads one (`hello-ja`, `hello-en`, `subtitles-ja`), so
  `npx avatarscript make --avatar <avatar URL> --script example:hello-ja ...` works with nothing
  but npx. `--help` lists the bundled scripts; an unknown name fails with the list. The score
  records `example:<name>` as its script.
- **README** (#8): the first command-line example is npx-only, followed by a note that
  `npx avatarscript` does not work inside a clone of the repository (even after a build) and what
  to run there instead.
- **Development** (#10): yarn is the only package manager (`package-lock.json` removed); `vite` is
  an explicit devDependency, since yarn v1 does not install vitest's peer dependency.
- **CI** (#9): `actions/checkout` and `actions/setup-node` v7; checks and the package smoke on
  Node 24; tests on Node 22 and 24 on both ubuntu and macOS.
