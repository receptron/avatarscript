# AvatarScript

Turn an avatar and text into a lip-synced, acted video:

```
avatar package + text ──► AvatarScript (.avs) ──► compiler + TTS ──► score.json + audio ──► video.mp4
```

AvatarScript defines a standard avatar package, a script language for directing an avatar's
speech, emotion and gestures, and a compiler and renderer that produce the video. The first
runtime is the mesh avatar engine from
[mesh-avatar-studio](https://github.com/shinshin86/mesh-avatar-studio).
See [PLAN.md](PLAN.md) for the design and milestones.

## Status

Early, but working end to end: ElevenLabs speech, Japanese and English lip sync, emotions and
motions, rendered to MP4 with the mesh engine. Not yet: the LLM step that writes scripts,
gaze and emphasis rendering, other TTS providers.

## Install

Requires Node.js 22.18+ and ffmpeg. The package includes the mesh avatar engine, so nothing
else is needed to render. (It is not on npm yet; `npm pack` in this repository makes the
package, or install from a checkout.)

```sh
npm install avatarscript
echo "ELEVENLABS_API_KEY=..." > .env    # read from the environment or ./.env
```

## Command line

```sh
npx avatarscript make --avatar ../mesh-avatar-studio/samples/miko-qipao \
  --script examples/hello-ja.avs --tts elevenlabs -o out/hello-ja.mp4
```

This writes `out/hello-ja.wav`, `out/hello-ja.score.json` and `out/hello-ja.mp4`. Synthesized
speech is cached per segment in `out/.tts-cache/`, so changing motions or one sentence does not
request the whole script again. `--tts mock` runs the pipeline offline with a buzzing stand-in
voice. The steps can also be run separately with `compile` and `render`; run
`npx avatarscript --help` for all options (voice, model, size, fps, background, seed).

`--avatar` takes a mesh-avatar-studio project folder (`rig.json` + `built/`) or a folder with an
`avatar.json` manifest. Only the text is sent to ElevenLabs; avatar images stay local, and the
render page has no network access.

## Library

[`examples/make-video.ts`](examples/make-video.ts) is a complete, runnable example. In short:

```js
import { loadAvatar, parseScript, compile, render, elevenLabs, cached, toWav } from "avatarscript";
import { writeFile } from "node:fs/promises";

const avatar = await loadAvatar("path/to/avatar");
const tts = cached(elevenLabs({ apiKey: process.env.ELEVENLABS_API_KEY, voiceId: "..." }), "out/.tts-cache");
const { score, audio } = await compile(parseScript("[emotion:happy] Hello! <nod>"), tts, { lang: "en", audioName: "hello.wav" });
await writeFile("out/hello.wav", toWav(audio));
await render({ avatar, score, audioPath: "out/hello.wav", out: "out/hello.mp4" });
```

`compile` returns the timed score and the audio; `render` turns a score into a video. Other
speech providers plug in through the `TtsAdapter` interface. `ScoreSchema` and
`AvatarManifestSchema` (zod) validate scores and manifests read from files.

## Scripts

A script is the text to speak with inline direction. Plain `.txt` files are spoken as is.

```text
---
lang: ja
---
[emotion:happy] みなさん、こんにちは！<nod> ミコです。
[pause:300ms]
[emotion:surprised] テキストを書くだけで、私がしゃべるんです！<surprise>
```

| Syntax | Meaning |
|---|---|
| `[emotion:NAME]` | `neutral happy sad angry surprised relaxed` from here on; with `eleven_v3` the voice gets a matching emotion tag |
| `[pause:300ms]`, `[pause:1.2s]` | silence |
| `<motion>` | play a motion with the next spoken character (at the end of a line: when the line ends). Mesh avatars: `nod tilt think giggle surprise shy no wink greet` and the idle motions |
| `[gaze:left]`, `*word*` | parsed, not rendered yet |
| `\[ \< \* \\` | literal characters |
| front matter | `lang` (default: detected from the text) |

## How lip sync works

1. Each segment is synthesized with ElevenLabs `/with-timestamps` (default model `eleven_v3`,
   with `language_code`), which reports when each character is spoken.
2. The timing is corrected against the audio: the voice's onset and offset and the silences at
   punctuation are measured, and the character timeline is stretched to match. (v3 timing can
   start up to 0.4 s late after an emotion tag.)
3. Characters become visemes: Japanese through kana morae (kanji readings from kuromoji),
   Latin-script words through spelling rules, anything else through a generic open/close.
4. The renderer drives the mesh engine frame by frame in headless Chrome, seeded so renders
   repeat exactly, and pipes the frames to ffmpeg.

## Develop

Clone [mesh-avatar-studio](https://github.com/shinshin86/mesh-avatar-studio) next to this
repository: running from source (`node src/cli.ts …`) bundles the engine from that checkout
(or from `--engine <dir>` / `AVATARSCRIPT_MESH_ENGINE`).

```sh
npm install
npm run format     # Prettier
npm run lint       # ESLint, including type-aware rules
npm test
npm run typecheck
npm run build      # dist/, including the engine bundled from ../mesh-avatar-studio
scripts/smoke.sh ../mesh-avatar-studio/samples/miko-qipao   # pack, install, render (as CI does)
```

CI (`.github/workflows/ci.yml`) runs Prettier, ESLint, the typecheck and build, the tests on Ubuntu and macOS,
and the package smoke above, against a pinned mesh-avatar-studio commit.

`npm run build` records the engine's source commit in `dist/engine/source.json`.

## License

[MIT](LICENSE). The bundled mesh avatar engine (`dist/engine/`) is from
[mesh-avatar-studio](https://github.com/shinshin86/mesh-avatar-studio), MIT License,
© Yuki Shindo; its license is included as `dist/engine/LICENSE.mesh-avatar-studio`. The
Miko sample character in mesh-avatar-studio has its own usage terms and is not included.
