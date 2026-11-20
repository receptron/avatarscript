// What manageAvatarScript's getGuide answers: how to make the avatar sing or speak, written for
// an LLM to act on. The syntax here is the script language of README.md ("Scripts").
import { EMOTIONS } from "./script.ts";

export const TOOL_GUIDE = `# manageAvatarScript

An avatar that sings or speaks, with its mouth following the words: performing in the user's
player, or as a video of it, as the answer says.

## Singing a JingleScript song (action "sing")

1. Make the song with manageJingleScript: a score whose sung notes each have a \`lyric\` (one kana
   mora per note for a voice that sings), and renderScore. Its answer has \`audioFile\` and
   \`timingFile\`.
2. Call manageAvatarScript with { "action": "sing", "audioFile": …, "timingFile": … }, the two
   paths exactly as renderScore answered them.

The mouth follows the lyric syllables in the timing map: the vowel opens on each note and is held
for the note's length, and the mouth closes in the rests. A song without lyrics cannot be sung
(the answer says so): add \`lyric\`s to the score and render it again.
Options: \`emotion\` for the whole song (${EMOTIONS.join(", ")}; default neutral), \`subtitles: true\`
to draw each lyric line while it is sung, \`fileName\` to name it.
If renderScore said the audio is "still rendering", the files are written when it is ready: an
error that a file is not there yet means wait a moment and call sing again.

## Speaking a script (action "speak")

{ "action": "speak", "script": "[emotion:happy] Hello! <nod> I am the avatar." }

A script is the text to say with directions inline:

- \`[emotion:NAME]\`: ${EMOTIONS.join(", ")}; from there on.
- \`[pause:300ms]\`, \`[pause:1.2s]\`: silence.
- \`<motion>\`: a motion with the next spoken character (at the end of a line: when the line ends):
  nod, tilt, think, giggle, surprise, shy, no, wink, greet.
- \`\\[ \\< \\* \\\\\`: those characters themselves.
- Optional front matter at the top, between two lines of \`---\`: \`lang: ja\` (default: detected
  from the text), \`background: "#203040"\` (a CSS colour), \`avatar-x: 68%\`, \`avatar-scale: 85%\`.

Example:

---
lang: ja
---
[emotion:happy] みなさん、こんにちは！<nod>
[pause:300ms]
[emotion:surprised] テキストを書くだけで、私がしゃべるんです！<surprise>

Options: \`subtitles: true\` draws each sentence while it is spoken; \`voice\` and \`tts\` only when
the user asks for a voice or a provider. Speaking needs a text-to-speech key on this computer; when
there is none the answer says so, and singing still works.

## Both

The answer says how it is shown. With \`shown\`, the avatar itself performs in the user's player
at once, and they can download a video of it there; with \`video\`, a video was made (that takes
about as long as it lasts) and kept at that path. Either way it starts when the user presses play.
`;
