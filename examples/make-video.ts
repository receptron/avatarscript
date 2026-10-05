// Make a lip-synced video with the library API.
//
//   npm run build                                          # once: the package entry is dist/
//   node --env-file-if-exists=.env examples/make-video.ts  # needs ELEVENLABS_API_KEY and ffmpeg
//
// Writes out/hello.wav, out/hello.score.json and out/hello.mp4. To try the pipeline without a key,
// replace the provider with mockTts() — it makes a buzzing stand-in voice, not speech.
import { mkdir, writeFile } from "node:fs/promises";
import { cached, compile, detectLang, elevenLabs, loadAvatar, parseScript, render, toWav } from "avatarscript";

// 1. The avatar: a mesh-avatar-studio project folder (rig.json + built/) or an avatar.json package.
const avatar = await loadAvatar("../mesh-avatar-studio/samples/miko-qipao");

// 2. The script: text with direction. Use plainScript(text) for text without markup.
const script = parseScript(`
[emotion:happy] Hi everyone! <nod> I'm Miko.
[pause:300ms]
[emotion:surprised] You just write the words, and I speak them! <surprise>
`);

// 3. The speech provider: ElevenLabs returns per-character timing for lip sync.
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) throw new Error("Set ELEVENLABS_API_KEY (environment or .env)");
const tts = cached(elevenLabs({ apiKey, voiceId: "EXAVITQu4vr4xnSDxMaL", model: "eleven_v3" }), "out/.tts-cache");

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
