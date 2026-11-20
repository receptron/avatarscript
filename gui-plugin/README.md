# @gui-chat-plugin/avatarscript

[AvatarScript](https://github.com/receptron/avatarscript) as a
[GUI Chat Protocol](https://github.com/receptron/gui-chat-protocol) plugin: the tool
`manageAvatarScript`, and a **video view** for what it makes.

- `sing`: the avatar sings a song made with [JingleScript](https://github.com/receptron/jinglescript).
  The LLM renders the song with `manageJingleScript` (`renderScore`), which answers `audioFile` and
  `timingFile` on a host that keeps renders as files, and passes the two paths here. The mouth
  follows the lyric syllables of the timing map; nothing is synthesized, and no key is needed.
- `speak`: the avatar says a script (`[emotion:happy] Hello! <nod>`). It needs a text-to-speech
  key on the server (`ELEVENLABS_API_KEY`, `OPENAI_API_KEY` or `GEMINI_API_KEY`; `AVATARSCRIPT_TTS`
  names the provider when several are set).
- `getGuide`: how to do both, as text for the LLM.

A video that was made comes back as `data` and the view plays it: the browser's controls, the
words (lyric lines or sentences; the one being heard is marked, and clicking one jumps there) and
a download. Nothing plays by itself. Every other answer, errors included, is text for the LLM.

## Adding it to a host

Two entries, as for other server-run plugins:

- **`"@gui-chat-plugin/avatarscript"`** (main entry, Node): `TOOL_DEFINITION` and `pluginCore`,
  whose `execute` runs on the host's server. The renderer needs **Chrome** (puppeteer's) and
  **ffmpeg** there. The video is embedded in the result as a data URI, so no file serving is
  needed.
- **`"@gui-chat-plugin/avatarscript/vue"`** (browser): `plugin` with the view and the card
  preview. It does not load the library.

What the host may put in `execute`'s context:

- `files.byPath` (the protocol's `FileOps`, as `manageJingleScript` and presentDocument get): a
  song's `audioFile` and `timingFile` are read through it, so the host decides what a path may
  reach, and every video is also kept as `avatarscript/<stem>.mp4`, never over an earlier one
  (`<stem>-2`, `<stem>-3` …), with its path told to the LLM. Without it, `sing` is refused and
  `speak` keeps no file.
- `avatar`: the avatar when a call names none, a folder on the server or an https URL. Default:
  the sample avatar published in
  [mulmocast-media](https://github.com/receptron/mulmocast-media/tree/main/avatars), fetched once
  and cached in `~/.cache/avatarscript/avatars/`. A call may name only an https URL.

## Size and time

A video takes about as long to make as it lasts (a 10.6 s song: 6 s on an M-series Mac), and the
tool call waits for it. It is 854×480 H.264; 10.6 s is about 2 MB, embedded in the result.

## Develop

```sh
yarn install        # in the repository root first, then here
yarn definition     # src/definition.json, from the library's schema (a test fails when it is stale)
yarn typecheck && yarn test && yarn build
yarn demo-data <folder> <audio> <timing.json>   # a real video of the sample avatar → demo/sample.json
yarn demo           # the view with that result
```

Typecheck and tests use the library's source (`../src`), not its `dist/`; the tests stand in for
the renderer, so they need neither Chrome nor ffmpeg.
