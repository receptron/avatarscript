#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { toWav } from "./audio.ts";
import { loadAvatar, type Avatar } from "./avatar.ts";
import { compile, detectLang } from "./compile.ts";
import { render } from "./render.ts";
import { parseJson } from "./json.ts";
import { ScoreSchema, type Score } from "./score.ts";
import { parseScript, plainScript, type Script } from "./script.ts";
import { createTts, isTtsProvider, TTS_PROVIDERS, type TextToSpeech } from "./tts/index.ts";

const USAGE = `Usage:
  avatarscript make    --avatar <dir|url> --script <file.avs|file.txt> -o <video.mp4|.webm|.mov> [options]
  avatarscript compile --avatar <dir|url> --script <file.avs|file.txt> -o <name.score.json> [options]
  avatarscript render  --avatar <dir|url> --score <name.score.json> -o <video.mp4> [options]

Speech (make, compile):
  --tts <provider>         elevenlabs, openai or gemini (keys: ELEVENLABS_API_KEY, OPENAI_API_KEY,
                           GEMINI_API_KEY), or mock (offline buzz, no key)
  --voice <id>             the provider's voice (default: avatar.json, then a stock voice)
  --model <id>             the provider's model (default: avatar.json, then the provider's default)
  --lang <code>            language of the text (default: front matter, then detected)

Video (make, render):
  --fps <n>                frames per second (default 30)
  --size <WxH>             video size (default 1280x720)
  --background <bg>        colour (CSS; "transparent" needs .webm or .mov) or image file behind the avatar
                           (default: the script's background, then #e9edf2)
  --avatar-x <n%>          horizontal centre of the avatar (default 50%)
  --avatar-y <n%>          bottom edge of the avatar (default 100%)
  --avatar-scale <n%>      height of the avatar, share of the video height (default 100%)
  --seed <n>               randomness of blinks and idle motion (default 1)
  --subtitles              draw subtitles (style from the script's subtitle-* front matter)
  --no-subtitles           do not draw subtitles, even if the script turns them on
  --engine <dir>           mesh-avatar-studio checkout (default ../mesh-avatar-studio)

API keys are read from the environment or a .env file.`;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [resolve(".env"), join(repoRoot, ".env")]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}

const { positionals, values: args } = parseArgs({
  allowPositionals: true,
  allowNegative: true,
  options: {
    avatar: { type: "string" },
    script: { type: "string" },
    score: { type: "string" },
    out: { type: "string", short: "o" },
    tts: { type: "string" },
    voice: { type: "string" },
    model: { type: "string" },
    lang: { type: "string" },
    fps: { type: "string" },
    size: { type: "string" },
    background: { type: "string" },
    seed: { type: "string" },
    engine: { type: "string" },
    subtitles: { type: "boolean" },
    "avatar-x": { type: "string" },
    "avatar-y": { type: "string" },
    "avatar-scale": { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

function need(name: keyof typeof args): string {
  const v = args[name];
  if (typeof v !== "string" || !v) throw new Error(`--${name} is required\n\n${USAGE}`);
  return v;
}

const num = (name: "fps" | "seed", fallback: number) => {
  const v = args[name];
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a whole number`);
  return n;
};

function textToSpeech(avatar: Avatar, cacheDir: string): TextToSpeech {
  const provider = need("tts");
  if (!isTtsProvider(provider)) throw new Error(`unknown --tts "${provider}" (use ${TTS_PROVIDERS.join(" or ")})`);
  // avatar.json can name a default voice and model per provider
  const preset = avatar.manifest.voice?.[provider] ?? {};
  return createTts({ provider, model: args.model ?? preset.model, voice: args.voice ?? preset.voice, cacheDir });
}

async function loadScript(path: string): Promise<Script> {
  const source = await readFile(path, "utf8");
  return extname(path) === ".avs" ? parseScript(source) : plainScript(source);
}

async function compileStep(avatar: Avatar, scorePath: string): Promise<Score> {
  const scriptPath = need("script");
  const script = await loadScript(scriptPath);
  const lang = args.lang ?? script.meta.lang ?? detectLang(script.plain);
  const tts = textToSpeech(avatar, join(dirname(scorePath), ".tts-cache"));
  const audioPath = scorePath.replace(/(\.score)?\.json$/, "") + ".wav";
  const { score, audio } = await compile(script, tts, {
    lang,
    subtitles: args.subtitles,
    scriptName: relative(dirname(scorePath), scriptPath),
    baseDir: dirname(resolve(scriptPath)),
    audioName: basename(audioPath),
    onSegment: (i, n, text) => console.log(`speech ${i + 1}/${n}: ${text.length > 40 ? text.slice(0, 40) + "…" : text}`),
  });
  await mkdir(dirname(scorePath), { recursive: true });
  await writeFile(audioPath, toWav(audio));
  await writeFile(scorePath, JSON.stringify(score, null, 1) + "\n");
  console.log(`wrote ${scorePath} and ${audioPath} (${score.duration.toFixed(1)} s)`);
  return score;
}

async function renderStep(avatar: Avatar, score: Score, scorePath: string, out: string) {
  const size = /^(\d+)x(\d+)$/.exec(args.size ?? "1280x720");
  if (!size) throw new Error("--size must look like 1280x720");
  await mkdir(dirname(out), { recursive: true });
  let last = -1;
  await render({
    avatar,
    score,
    out,
    audioPath: resolve(dirname(scorePath), score.audio),
    fps: num("fps", 30),
    width: Number(size[1]),
    height: Number(size[2]),
    seed: num("seed", 1),
    view: {
      ...(args.background ? { background: args.background } : {}),
      ...(args["avatar-x"] ? { avatarX: args["avatar-x"] } : {}),
      ...(args["avatar-y"] ? { avatarY: args["avatar-y"] } : {}),
      ...(args["avatar-scale"] ? { avatarScale: args["avatar-scale"] } : {}),
    },
    engineRoot: args.engine,
    subtitles: args.subtitles,
    onProgress: (f, n) => {
      const pct = Math.floor((f / n) * 10) * 10;
      if (pct !== last) {
        last = pct;
        console.log(`render ${pct}% (${f}/${n} frames)`);
      }
    },
  });
  console.log(`wrote ${out}`);
}

async function main() {
  const command = positionals[0];
  if (args.help || !command) {
    console.log(USAGE);
    return;
  }
  const avatar = await loadAvatar(need("avatar"));
  const out = resolve(need("out"));
  if (command === "compile") {
    if (!out.endsWith(".json")) throw new Error("compile writes a score: -o must end with .score.json");
    await compileStep(avatar, out);
  } else if (command === "render") {
    const scorePath = resolve(need("score"));
    await renderStep(avatar, parseJson(ScoreSchema, await readFile(scorePath, "utf8"), scorePath), scorePath, out);
  } else if (command === "make") {
    const scorePath = out.replace(/\.[^./]+$/, "") + ".score.json";
    await renderStep(avatar, await compileStep(avatar, scorePath), scorePath, out);
  } else {
    throw new Error(`unknown command "${command}"\n\n${USAGE}`);
  }
}

main().catch((error: unknown) => {
  console.error(`avatarscript: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
