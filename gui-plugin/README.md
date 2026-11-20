# @gui-chat-plugin/avatarscript

[AvatarScript](https://github.com/receptron/avatarscript) as a
[GUI Chat Protocol](https://github.com/receptron/gui-chat-protocol) plugin: the tool
`manageAvatarScript`, and a view in which **the avatar performs live**.

- `sing`: the avatar sings a song made with [JingleScript](https://github.com/receptron/jinglescript).
  The LLM renders the song with `manageJingleScript` (`renderScore`), which answers `audioFile` and
  `timingFile` on a host that keeps renders as files, and passes the two paths here. The mouth
  follows the lyric syllables of the timing map; nothing is synthesized, and no key is needed.
- `speak`: the avatar says a script (`[emotion:happy] Hello! <nod>`). It needs a text-to-speech
  key on the server (`ELEVENLABS_API_KEY`, `OPENAI_API_KEY` or `GEMINI_API_KEY`; `AVATARSCRIPT_TTS`
  names the provider when several are set).
- `getGuide`: how to do both, as text for the LLM.

## Live, or a video

**Live** (a host that sets `liveAvatar`): the call answers at once with a performance (the score,
the audio and the voice levels; about 200 KB for a 10 s song), and the view draws the avatar
itself with the mesh engine, following the audio: play and pause, a position slider, the words
(lyric lines or sentences; the one being heard is marked, and clicking one jumps there) and, when
asked for, subtitles over the avatar. Until play is pressed the avatar idles. Nothing is rendered
until the user presses **Download MP4**; the video is then made on the server (about as long as
it lasts), downloaded, and kept in the host's files.

**A video** (a host without `liveAvatar`): the video is rendered on the server before the call
answers and embedded in the result (about 2 MB for 10 s at 854×480); the view plays it with the
browser's controls.

Nothing plays by itself either way. Every other answer, errors included, is text for the LLM. The
card and its preview take their text colour from the host, so they fit a light or a dark page
whatever the system's colour scheme is.

## Adding it to a host

Two entries, as for other server-run plugins:

- **`"@gui-chat-plugin/avatarscript"`** (main entry, Node): `TOOL_DEFINITION` and `pluginCore`,
  whose `execute` runs on the host's server. It needs **ffmpeg** there to read a song that is not a
  WAV, and **Chrome** (puppeteer's) with ffmpeg to make a video.
- **`"@gui-chat-plugin/avatarscript/vue"`** (browser): `plugin` with the view and the card
  preview. It loads the library's browser entry (`avatarscript/player`) and, when it shows an
  avatar, the mesh engine (`mesh-avatar`, this package's one runtime dependency); never the
  library's index.

What the host may put in `execute`'s context:

- `files.byPath` (the protocol's `FileOps`, as `manageJingleScript` and presentDocument get): a
  song's `audioFile` and `timingFile` are read through it, so the host decides what a path may
  reach, and every video that is made is kept as `avatarscript/<stem>.mp4`, never over an earlier
  one (`<stem>-2`, `<stem>-3` …). Without it, `sing` is refused and no video is kept.
- `liveAvatar: true`, when the host gives each view a runtime whose `dispatch` reaches this
  plugin's `execute` (the view's requests for the avatar and for the video come through it, and
  `execute` answers them before reading a call as a tool call). Without it, videos as above.
- `avatar`: the avatar when a call names none, a folder on the server or an https URL. Default:
  the sample avatar published in
  [mulmocast-media](https://github.com/receptron/mulmocast-media/tree/main/avatars), fetched once
  and cached in `~/.cache/avatarscript/avatars/`. A call, and a view, may name only an https URL.

A live view asks for its avatar when it is shown (a few MB, once per page for each avatar) and
holds one WebGL canvas while it is mounted.

## Develop

```sh
yarn install        # in the repository root first, then here
yarn definition     # src/definition.json, from the library's schema (a test fails when it is stale)
yarn typecheck && yarn test && yarn build
yarn demo-data <folder> <audio> <timing.json>   # the sample avatar sings that song → demo/sample.json
yarn demo           # the live view with that result (add ?dark for a dark host)
```

Typecheck and tests use the library's source (`../src`), not its `dist/`; the tests stand in for
the renderer, so they need neither Chrome nor ffmpeg.
