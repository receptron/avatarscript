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

## Setup

Requires Node.js 22.18+ and ffmpeg. Clone
[mesh-avatar-studio](https://github.com/shinshin86/mesh-avatar-studio) next to this repository
(or pass `--engine <dir>`); its engine is bundled at render time and its sample avatar is used
below.

```sh
npm install
echo "ELEVENLABS_API_KEY=..." > .env    # .env is git-ignored
```

## Make a video

```sh
node src/cli.ts make --avatar ../mesh-avatar-studio/samples/miko-qipao \
  --script examples/hello-ja.avs --tts elevenlabs -o out/hello-ja.mp4
```

This writes `out/hello-ja.wav`, `out/hello-ja.score.json` and `out/hello-ja.mp4`. Synthesized
speech is cached per segment in `out/.tts-cache/`, so changing motions or one sentence does not
request the whole script again. `--tts mock` runs the pipeline offline with a buzzing stand-in
voice. The steps can also be run separately with `compile` and `render`; run
`node src/cli.ts --help` for all options (voice, model, size, fps, background, seed).

`--avatar` takes a mesh-avatar-studio project folder (`rig.json` + `built/`) or a folder with an
`avatar.json` manifest. Only the text is sent to ElevenLabs; avatar images stay local, and the
render page has no network access.

## Scripts

A script is the text to speak with inline direction. Plain `.txt` files are spoken as is.

```text
---
lang: ja
---
[emotion:happy] みなさん、こんにちは！<nod> ミコです。
[pause:300ms]
[emotion:surprised] 文章を書くだけで、私がしゃべるんです！<surprise>
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

```sh
npm test
npm run typecheck
```

## License

[MIT](LICENSE)
