// Make a lip-synced video with the library API.
//
//   npm run build                                          # once: the package entry is dist/
//   node --env-file-if-exists=.env examples/make-video.ts  # needs ELEVENLABS_API_KEY and ffmpeg
//
// Writes out/hello.wav, out/hello.score.json and out/hello.mp4. The speech provider is a parameter:
// the rest of the code does not change with it. ("mock" runs without a key but makes a buzz, not speech.)
import { mkdir, writeFile } from "node:fs/promises";
import { compile, createTts, detectLang, loadAvatar, parseScript, render, toWav } from "avatarscript";

// 1. The avatar: an avatar.json package (here the bundled sample, ani) or a mesh-avatar-studio
// project folder (rig.json + built/).
const avatar = await loadAvatar("avatars/ani");

// 2. The script: text with direction. Use plainScript(text) for text without markup.
const script = parseScript(`
[emotion:happy] Hi everyone! <nod> I'm Ani.
[pause:300ms]
[emotion:surprised] You just write the words, and I speak them! <surprise>
`);

// 3. Text-to-speech. The API key comes from the provider's environment variable (here
// ELEVENLABS_API_KEY); without it createTts() throws. model and voice are optional.
const tts = createTts({ provider: "elevenlabs", model: "eleven_v3", cacheDir: "out/.tts-cache" });

// 4. Compile: speech + timing → a timed score and the audio.
const { score, audio } = await compile(script, tts, {
  lang: detectLang(script.plain),
  audioName: "hello.wav",
  onSegment: (i, n, text) => console.log(`speech ${i + 1}/${n}: ${text}`),
});
await mkdir("out", { recursive: true });
await writeFile("out/hello.wav", toWav(audio));
await writeFile("out/hello.score.json", JSON.stringify(score, null, 1));
console.log(`${score.duration}s, ${score.visemes.length} mouth shapes, ${score.cues.length} cues`);

// 5. Render: score + avatar → MP4 (headless Chrome + ffmpeg).
await render({
  avatar,
  score,
  audioPath: "out/hello.wav",
  out: "out/hello.mp4",
  width: 1280,
  height: 720,
  onProgress: (frame, total) => {
    if (frame === total) console.log(`rendered ${total} frames`);
  },
});
console.log("wrote out/hello.mp4");
