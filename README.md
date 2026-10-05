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

Early, but working end to end: speech from ElevenLabs, OpenAI or Gemini, Japanese and English
lip sync, emotions and motions, rendered to MP4 with the mesh engine. Not yet: the LLM step that
writes scripts, gaze and emphasis rendering.

## Install

Requires Node.js 22.18+ and ffmpeg. The package includes the mesh avatar engine, so nothing
else is needed to render.

```sh
npm install avatarscript
npm install onnxruntime-node             # only for --tts openai or gemini (timing by alignment, ~290 MB)
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
import { loadAvatar, parseScript, compile, render, createTts, toWav } from "avatarscript";
import { writeFile } from "node:fs/promises";

const avatar = await loadAvatar("path/to/avatar");
const tts = createTts({ provider: "elevenlabs", cacheDir: "out/.tts-cache" }); // key from ELEVENLABS_API_KEY
const { score, audio } = await compile(parseScript("[emotion:happy] Hello! <nod>"), tts, { lang: "en", audioName: "hello.wav" });
await writeFile("out/hello.wav", toWav(audio));
await render({ avatar, score, audioPath: "out/hello.wav", out: "out/hello.mp4" });
```

`compile` returns the timed score and the audio; `render` turns a score into a video.
`ScoreSchema` and `AvatarManifestSchema` (zod) validate scores and manifests read from files.

### Speech you already have (`compileTimeline`)

A host that does its own text-to-speech (MulmoCast does) places existing audio files on a
timeline; no TTS is called, and timing comes from forced alignment (needs `onnxruntime-node`):

```js
import { avatarAspect, compileTimeline, loadAvatar, render, toWav } from "avatarscript";

const { score, audio } = await compileTimeline(
  [
    { text: "みなさん、こんにちは！", audio: "beat0.mp3", start: 1.0, emotion: "happy", motions: [{ motion: "nod", at: "こんにちは" }] },
    { text: "スライドの上で説明します。", audio: "beat1.mp3", start: 4.2 },
  ],
  { lang: "ja", duration: 9, view: { background: "transparent" } },
);
await writeFile("voice.wav", toWav(audio)); // moves the head with the voice
const avatar = await loadAvatar("path/to/avatar");
const height = 446, width = Math.round(height * avatarAspect(avatar.rig) / 2) * 2;
// one continuous, see-through avatar track, picture only, to overlay on another video
await render({ avatar, score, audioPath: "voice.wav", audio: false, out: "avatar.webm", width, height });
```

`motions[].at` names words in the text: the motion starts where they are spoken.
`avatarAspect` gives the avatar's width ÷ height, to size a track that holds nothing else. Pass
`padTop: 0` to both `avatarAspect(rig, 0)` and `render` for a track overlaid on other video: some rigs
crop the flat top edge of their image, which is only hidden when the avatar reaches the top of the
frame. (Placed with `avatar-y`/`avatar-scale` inside the frame, the whole image is shown already.)
Decode the WebM with `-c:v libvpx-vp9` in ffmpeg to keep its alpha.

### Text-to-speech

There is one API for every provider: `createTts({ provider, model?, voice?, apiKey?, options?, cacheDir? })`.
The provider is a parameter, and whatever it sends natively is normalized, so application code
does not change when the provider or model does:

- `synthesize(request)` always returns `Speech`: mono samples at `SPEECH_SAMPLE_RATE` (24 kHz) and
  one `{ start, end }` per character of the text. Other sample rates are resampled; timing that does
  not match the text is an error.
- `model` and `voice` default to the provider's; `apiKey` defaults to its environment variable.
  Provider-specific settings go in `options` and are checked by that provider.
- Providers today:

  | provider | key | timing | voice emotion | options |
  |---|---|---|---|---|
  | `elevenlabs` | `ELEVENLABS_API_KEY` | ElevenLabs', corrected against the audio | v3 audio tags | `emotionTags`, `seed` |
  | `openai` | `OPENAI_API_KEY` | forced alignment | `instructions` (gpt-4o-mini-tts) | `emotionInstructions`, `speed` |
  | `gemini` | `GEMINI_API_KEY` | forced alignment | none: only the text is sent | — |
  | `mock` | — | exact, made up | — | — |

- OpenAI and Gemini return audio only. Since the text is known, its timing is found by **forced
  alignment**: a phoneme model ([wav2vec2-lv-60-espeak-cv-ft](https://huggingface.co/facebook/wav2vec2-lv-60-espeak-cv-ft),
  Apache-2.0, as [ONNX](https://huggingface.co/sadda-speech/wav2vec2-espeak-ctc)) runs locally with
  onnxruntime, its phonemes are summed into broad classes, and the text (kana from kuromoji readings,
  or spelling) is fitted to them. Measured against ElevenLabs' own timing on 8 sentences: median
  error 19 ms (one model frame is 20 ms); 79% (Japanese) and 91% (English) of characters within 50 ms.
- The model (635 MB) is downloaded once from Hugging Face into `~/.cache/avatarscript/models`
  (or `AVATARSCRIPT_MODEL_DIR`). Audio and text never leave the machine for alignment.
- Speech that does not say the text — a provider reading extra words — is detected from the
  alignment, requested once more, and otherwise reported as an error. (Gemini models read style
  instructions aloud when they are written into the prompt, which is why only the text is sent.)

An avatar can name its default voice per provider in `avatar.json`:
`"voice": { "elevenlabs": { "voice": "<voice id>", "model": "eleven_v3" } }`.

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

## Subtitles, background and placement

All of these go in the script's front matter; CLI flags (`--subtitles`, `--no-subtitles`,
`--background`, `--avatar-x`, `--avatar-y`, `--avatar-scale`) and the library's `compile` /
`render` options (`subtitles`, `view`) override them.

```text
---
lang: ja
subtitles: on
subtitle-font: Hiragino Mincho ProN, Noto Serif CJK JP, serif
subtitle-size: 6%
subtitle-color: "#fff8e7"
subtitle-outline: "#5a2a14"
subtitle-background: rgba(0, 0, 0, 0.35)
subtitle-position: bottom
background: stage.png
avatar-x: 68%
avatar-scale: 85%
---
```

| Key | Meaning | Default |
|---|---|---|
| `subtitles` | `on` or `off` | `off` |
| `subtitle-font` | CSS font family list, or a font file (`.ttf`, `.otf`, `.woff`, `.woff2`) | Hiragino / Noto CJK / Yu Gothic, sans-serif |
| `subtitle-size` | `40px`, or a share of the video height (`6%`) | `5.5%` |
| `subtitle-weight` | `normal` or `bold` | `bold` |
| `subtitle-color`, `subtitle-outline`, `subtitle-background` | CSS colours; `none` turns the outline or background off | white, black, `none` |
| `subtitle-position` | `bottom`, `top` or `middle` | `bottom` |
| `subtitle-margin` | distance from the edge, `px` or `%` of the height | `6%` |
| `subtitle-max-width` | share of the video width; longer lines wrap into lines of even length | `90%` |
| `background` | a CSS colour, `transparent` (or any colour with alpha), or an image file (`.png`, `.jpg`, `.webp`, relative to the script; it covers the frame) | `#e9edf2` |
| `avatar-x` | horizontal centre of the avatar, % of the width | `50%` |
| `avatar-y` | bottom edge of the avatar, % of the height | `100%` |
| `avatar-scale` | height of the avatar, % of the height | `100%` |

Subtitles show one sentence at a time, timed by the speech; scores always carry these
`captions`, even when they are not drawn. A see-through background needs an output that keeps
alpha: `-o video.webm` (VP9) or `-o video.mov` (ProRes 4444); MP4 (H.264) is refused. Fonts named by
family must be installed where the video is rendered (Linux usually needs Noto CJK for Japanese);
a font file always works.

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
