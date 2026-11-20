// manageAvatarScript: the one tool AvatarScript offers to LLMs, independent of how it is carried.
// The GUI Chat Protocol plugin (gui-plugin/) wraps it: a ToolResult whose `data` a video view
// plays. A carrier says what files the model's paths may reach and where the video is kept; the
// tool itself only reads through the carrier and writes to a temporary folder it removes.
//
// A carrier whose view can show the avatar itself (`live`) gets a performance instead of a video:
// the score, the audio and the voice levels, which the view plays with the mesh engine in the
// browser, at once and with nothing rendered. The view asks for the avatar (avatarForView) and,
// when the user wants a file, for the video (renderPerformance).
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { readAudio } from "./audio-file.ts";
import { frameLevels, toWav, type Pcm } from "./audio.ts";
import { loadAvatar, type Avatar } from "./avatar.ts";
import { compile, detectLang } from "./compile.ts";
import { parseJson } from "./json.ts";
import { LEVEL_FPS } from "./perform.ts";
import { render, type RenderOptions } from "./render.ts";
import { ScoreSchema, type Score } from "./score.ts";
import { EMOTIONS, parseScript } from "./script.ts";
import { compileSong, parseSongTiming } from "./song.ts";
import type { Caption } from "./subtitles.ts";
import { TOOL_GUIDE } from "./tool-guide.ts";
import { createTts, isTtsProvider, type TextToSpeech, type TtsProvider } from "./tts/index.ts";

export const TOOL_NAME = "manageAvatarScript";
export const TOOL_ACTIONS = ["getGuide", "sing", "speak"] as const;
export type ToolAction = (typeof TOOL_ACTIONS)[number];

/** The avatar used when neither the call nor the carrier names one: the sample avatar, published in mulmocast-media. */
export const DEFAULT_AVATAR = "https://raw.githubusercontent.com/receptron/mulmocast-media/main/avatars/ani";

export const TOOL_DESCRIPTION =
  "Show an avatar that sings or speaks, with its mouth following the words. sing: the avatar sings a song made with JingleScript; render the song first (manageJingleScript, renderScore, with a `lyric` on the sung notes), then pass the `audioFile` and `timingFile` it answered. speak: the avatar says a script, text with directions such as [emotion:happy] and <nod>; action getGuide gives the syntax. The answer says how it is shown: the avatar performing in a player, or a video of it.";

/** The providers a call may name; `mock` (an offline buzz, for tests) is chosen only by AVATARSCRIPT_TTS. */
const SPEECH_PROVIDERS = ["elevenlabs", "openai", "gemini"] as const satisfies readonly TtsProvider[];

/** A file stem: letters, digits, dot, dash, underscore; never a path. */
const FILE_STEM = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/;

export const ToolInputSchema = z
  .strictObject({
    action: z
      .enum(TOOL_ACTIONS)
      .describe(
        "What to do. sing: a video of the avatar singing a JingleScript song. speak: a video of the avatar saying a script. getGuide: how to write a script.",
      ),
    audioFile: z.string().optional().describe("sing: path of the song's audio, the `audioFile` that manageJingleScript's renderScore answered."),
    timingFile: z
      .string()
      .optional()
      .describe("sing: path of the song's timing map, the `timingFile` that renderScore answered. The mouth follows its lyric syllables."),
    script: z.string().optional().describe('speak: what the avatar says, with directions inline: "[emotion:happy] Hello! <nod>". getGuide gives the syntax.'),
    emotion: z.enum(EMOTIONS).optional().describe("sing: the avatar's emotion for the whole song (default neutral). In a script, [emotion:NAME] sets it."),
    subtitles: z.boolean().optional().describe("true draws the words over the video: each lyric line while it is sung, or each sentence while it is spoken."),
    tts: z.enum(SPEECH_PROVIDERS).optional().describe("speak: the text-to-speech provider; leave out to use the one this computer is set up for."),
    voice: z.string().optional().describe("speak: the provider's voice id; leave out for the avatar's own voice."),
    avatar: z
      .url({ protocol: /^https$/ })
      .optional()
      .describe("The avatar: an https URL of an avatar package folder. Leave out for the default avatar."),
    fileName: z
      .string()
      .regex(FILE_STEM)
      .optional()
      .describe('File stem of the video (default "song" for sing, "speech" for speak). A name that is taken becomes "<stem>-2", "<stem>-3" …'),
  })
  .describe("Arguments of manageAvatarScript.");
export type ToolInput = z.infer<typeof ToolInputSchema>;

/** The tool's input as JSON Schema, for a tool definition. */
export const toolInputJsonSchema = (): Record<string, unknown> => z.toJSONSchema(ToolInputSchema, { target: "draft-7" });

/** What a view plays: the video and what it shows. */
export interface VideoData {
  kind: "song" | "speech";
  title: string;
  /** the video as a data URI */
  video: string;
  mimeType: "video/mp4";
  /** seconds */
  duration: number;
  width: number;
  height: number;
  /** the words and when they are heard: lyric lines, or sentences */
  captions: Caption[];
  /** where the carrier kept the video, when it keeps files */
  file?: string;
}

const AUDIO_DATA = /^data:(audio\/(?:mpeg|wav|ogg|mp4|flac));base64,/;
/** The longest performance a view may ask a video of, seconds. */
const MAX_DURATION = 3600;
/** A front matter value, or a score's, that names a file (an image behind the avatar, a font file for the subtitles). */
const FILE_VALUE = /\.(png|jpe?g|webp|ttf|otf|woff2?)$/i;

/**
 * What a view needs to make the avatar perform live, and what it sends back to have the video
 * made (so it is checked there as untyped data).
 */
export const PerformanceSchema = z
  .object({
    kind: z.enum(["song", "speech"]),
    title: z.string().max(200),
    /** seconds; the score's own duration, which is what a video is rendered to */
    duration: z.number().positive().max(MAX_DURATION),
    width: z.int().min(16).max(4096),
    height: z.int().min(16).max(4096),
    /** the song or the speech, as a data URI the view plays */
    audio: z.string().regex(AUDIO_DATA),
    /** the voice level of each frame at LEVEL_FPS, 0–1: it moves the head with the voice */
    levels: z.array(z.number()).max(MAX_DURATION * LEVEL_FPS + 1),
    /** the mouth shapes, speaking spans, cues, captions, background and placement */
    score: ScoreSchema,
    /** draw the captions over the avatar */
    subtitles: z.boolean(),
    /** the avatar the call named, an https URL; absent: the carrier's own */
    avatar: z.url({ protocol: /^https$/ }).optional(),
    /** which avatar that is, for a view to tell one from another without learning where the carrier's own is from */
    avatarKey: z.string().max(64).optional(),
  })
  // A video is rendered to the score's duration: the limit above must be on that one.
  .refine((performance) => performance.score.duration === performance.duration, { path: ["score", "duration"], message: "must be the performance's duration" });
export type PerformanceData = z.infer<typeof PerformanceSchema>;

/** The avatar a view may name: an https URL, or none. */
const AvatarUrlSchema = z.url({ protocol: /^https$/ }).optional();

/** An avatar as the mesh engine takes it in a page. */
export interface AvatarAssets {
  rig: unknown;
  /** asset name → data URL */
  assets: Record<string, string>;
}

export interface ToolResult {
  /** What the model reads: a JSON summary, a guide, or an error it can act on. */
  text: string;
  isError: boolean;
  /** For a view: present after a video was made. */
  video?: VideoData;
  /** For a view that shows the avatar itself (a `live` carrier): present instead of `video`. */
  performance?: PerformanceData;
}

export interface ToolCarrier {
  /** Reads a file the model names (the carrier decides what a path may reach). Without it, sing is refused. */
  readFile?: (path: string) => Promise<Uint8Array>;
  /**
   * Keeps the video under `name` ("song.mp4") and returns the path the model is told, or undefined,
   * without writing, when the name is taken: it never overwrites. Without it, the video is only in the result.
   */
  saveFile?: (name: string, content: Uint8Array) => Promise<string | undefined>;
  /** The avatar when the call names none: a folder or an https URL (default DEFAULT_AVATAR). */
  avatar?: string;
  /**
   * The carrier's view shows the avatar itself and can call back (avatarForView,
   * renderPerformance): sing and speak then answer at once with a performance, and no video is
   * rendered until the view asks for one.
   */
  live?: boolean;
  /** Video size (default 854×480). */
  width?: number;
  height?: number;
  /** Where synthesized speech is cached between calls (default: a folder in the system's temporary directory). */
  ttsCacheDir?: string;
  /** Stand-ins for loading the avatar and for the renderer, which needs Chrome and ffmpeg (tests). */
  loadAvatar?: (location: string) => Promise<Avatar>;
  render?: (options: RenderOptions) => Promise<void>;
}

const DEFAULT_WIDTH = 854;
const DEFAULT_HEIGHT = 480;
/** Most names tried for one video ("song", "song-2" … "song-1000") before giving up. */
const MAX_NAMES = 1000;
/** The audio a song may be, by file extension, and how a view is told its kind. */
const AUDIO_TYPES: readonly [extension: string, mimeType: string][] = [
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".ogg", "audio/ogg"],
  [".m4a", "audio/mp4"],
  [".flac", "audio/flac"],
];
const AUDIO_EXTENSIONS = AUDIO_TYPES.map(([extension]) => extension);

const json = (value: unknown): string => JSON.stringify(value, null, 2);
const fail = (text: string): ToolResult => ({ text, isError: true });

/** The extension of a path the model gave, lower case with its dot, when the path has no `.` or `..` segment. */
function extensionOf(path: string): string | undefined {
  if (path.includes("\0") || path.split(/[\\/]/).some((segment) => segment === "." || segment === "..")) return undefined;
  const dot = path.lastIndexOf(".");
  return dot < 0 ? undefined : path.slice(dot).toLowerCase();
}

/** Keeps the video under the first free name; undefined when the carrier keeps no files. */
async function keep(carrier: ToolCarrier, stem: string, video: Uint8Array): Promise<string | undefined> {
  if (carrier.saveFile === undefined) return undefined;
  for (let n = 1; n <= MAX_NAMES; n++) {
    const path = await carrier.saveFile(n === 1 ? `${stem}.mp4` : `${stem}-${n}.mp4`, video);
    if (path !== undefined) return path;
  }
  throw new Error(`No free file name for the video: "${stem}" to "${stem}-${MAX_NAMES}" are all taken. Give another \`fileName\`.`);
}

/** What sing or speak made: a score, the audio it plays, and the temporary folder they are in. */
interface Job {
  kind: VideoData["kind"];
  stem: string;
  score: Score;
  audioPath: string;
  dir: string;
  /** the audio as a view plays it, and its samples when they are at hand (speech) */
  audio: { bytes: Uint8Array; mimeType: string; pcm?: Pcm };
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

/** A performance for a view that shows the avatar itself: nothing is rendered. */
async function perform(job: Job, input: ToolInput, carrier: ToolCarrier): Promise<ToolResult> {
  const pcm = job.audio.pcm ?? (await readAudio(job.audioPath));
  const levels = frameLevels(pcm, LEVEL_FPS, Math.ceil(job.score.duration * LEVEL_FPS));
  const performance: PerformanceData = {
    kind: job.kind,
    title: input.fileName ?? job.stem,
    duration: job.score.duration,
    width: carrier.width ?? DEFAULT_WIDTH,
    height: carrier.height ?? DEFAULT_HEIGHT,
    audio: `data:${job.audio.mimeType};base64,${Buffer.from(job.audio.bytes).toString("base64")}`,
    levels: Array.from(levels, round3),
    score: job.score,
    // As the renderer resolves it: what the call says, else whether the script turns them on.
    subtitles: input.subtitles ?? job.score.subtitles !== null,
    ...(input.avatar === undefined ? {} : { avatar: input.avatar }),
    avatarKey: avatarKey(input.avatar, carrier),
  };
  const summary = {
    ok: true,
    duration: job.score.duration,
    [job.kind === "song" ? "lyricLines" : "sentences"]: job.score.captions.length,
    shown: "the avatar performs it in the player; a video file is made only when the user downloads one there",
  };
  return { text: json(summary), isError: false, performance };
}

/** What a video is rendered from: a job's, or a performance a view sent back. */
interface VideoJob {
  kind: VideoData["kind"];
  stem: string;
  title: string;
  score: Score;
  audioPath: string;
  dir: string;
  avatar: Avatar;
  width: number;
  height: number;
  subtitles: boolean | undefined;
}

async function makeVideo(job: VideoJob, carrier: ToolCarrier): Promise<ToolResult> {
  const { width, height } = job;
  const out = join(job.dir, "video.mp4");
  const started = Date.now();
  await (carrier.render ?? render)({ avatar: job.avatar, score: job.score, audioPath: job.audioPath, out, width, height, subtitles: job.subtitles });
  const bytes = await readFile(out);
  const file = await keep(carrier, job.stem, bytes);
  const video: VideoData = {
    kind: job.kind,
    title: job.title,
    video: `data:video/mp4;base64,${bytes.toString("base64")}`,
    mimeType: "video/mp4",
    duration: job.score.duration,
    width,
    height,
    captions: job.score.captions,
    ...(file === undefined ? {} : { file }),
  };
  const summary = {
    ok: true,
    ...(file === undefined ? {} : { video: file }),
    duration: job.score.duration,
    size: `${width}x${height}`,
    [job.kind === "song" ? "lyricLines" : "sentences"]: job.score.captions.length,
    renderSeconds: Math.round((Date.now() - started) / 100) / 10,
  };
  return { text: json(summary), isError: false, video };
}

/** The avatar a call or a view named (an https URL), else the carrier's, else the sample avatar. */
const avatarAt = (named: string | undefined, carrier: ToolCarrier): Promise<Avatar> =>
  (carrier.loadAvatar ?? loadAvatar)(named ?? carrier.avatar ?? DEFAULT_AVATAR);

/** Which avatar that is, as a view may know it: a digest, since the carrier's own may be a folder on its computer. */
const avatarKey = (named: string | undefined, carrier: ToolCarrier): string =>
  createHash("sha256")
    .update(named ?? carrier.avatar ?? DEFAULT_AVATAR)
    .digest("hex")
    .slice(0, 16);

/** A job as a live performance (a `live` carrier), or as a video. */
async function present(job: Job, input: ToolInput, carrier: ToolCarrier, avatar?: Avatar): Promise<ToolResult> {
  if (carrier.live === true) return perform(job, input, carrier);
  return makeVideo(
    {
      kind: job.kind,
      stem: job.stem,
      title: input.fileName ?? job.stem,
      score: job.score,
      audioPath: job.audioPath,
      dir: job.dir,
      avatar: avatar ?? (await avatarAt(input.avatar, carrier)),
      width: carrier.width ?? DEFAULT_WIDTH,
      height: carrier.height ?? DEFAULT_HEIGHT,
      subtitles: input.subtitles,
    },
    carrier,
  );
}

async function sing(input: ToolInput, carrier: ToolCarrier, dir: string): Promise<ToolResult> {
  const { audioFile, timingFile } = input;
  if (audioFile === undefined || timingFile === undefined)
    return fail("sing needs `audioFile` and `timingFile`: the two paths manageJingleScript's renderScore answered for the song.");
  if (carrier.readFile === undefined) return fail("This host cannot read files, so the avatar cannot be handed a song here.");
  const extension = extensionOf(audioFile);
  if (extension === undefined || !AUDIO_EXTENSIONS.includes(extension))
    return fail(`\`audioFile\` must name an audio file (${AUDIO_EXTENSIONS.join(", ")}), without \`.\` or \`..\` segments: ${JSON.stringify(audioFile)}.`);
  if (extensionOf(timingFile) !== ".json")
    return fail(`\`timingFile\` must name a .json file, without \`.\` or \`..\` segments: ${JSON.stringify(timingFile)}.`);
  const timingText = new TextDecoder().decode(await carrier.readFile(timingFile));
  const timing = parseSongTiming(parseJson(z.unknown(), timingText, timingFile), timingFile);
  // The extension is kept: an MP3 from JingleScript plays 23 ms late, and the song's times allow for it.
  const audioName = `song${extension}`;
  const audioPath = join(dir, audioName);
  const bytes = await carrier.readFile(audioFile);
  await writeFile(audioPath, bytes);
  const score = await compileSong(timing, { audioName, emotion: input.emotion });
  const mimeType = AUDIO_TYPES.find(([ext]) => ext === extension)?.[1] ?? "audio/mpeg";
  return present({ kind: "song", stem: input.fileName ?? "song", score, audioPath, dir, audio: { bytes, mimeType } }, input, carrier);
}

/** Front matter that may name a file (an image behind the avatar, a font file for the subtitles). */
const FILE_KEYS = ["background", "subtitle-font"] as const;

/** The provider speak uses: the call's, then AVATARSCRIPT_TTS, then the first whose key is set. */
function speechProvider(input: ToolInput): TtsProvider {
  if (input.tts !== undefined) return input.tts;
  const named = process.env.AVATARSCRIPT_TTS;
  if (named !== undefined && named !== "") {
    if (!isTtsProvider(named)) throw new Error(`AVATARSCRIPT_TTS names an unknown text-to-speech provider: "${named}".`);
    return named;
  }
  const keys: [TtsProvider, string | undefined][] = [
    ["elevenlabs", process.env.ELEVENLABS_API_KEY],
    ["openai", process.env.OPENAI_API_KEY],
    ["gemini", process.env.GEMINI_API_KEY],
  ];
  const keyed = keys.find(([, key]) => key !== undefined && key !== "");
  if (keyed === undefined)
    throw new Error(
      "The avatar cannot speak on this computer: no text-to-speech key is set (ELEVENLABS_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY in the server's environment). Tell the user; singing a JingleScript song needs no key.",
    );
  return keyed[0];
}

function speech(input: ToolInput, carrier: ToolCarrier, avatar: Avatar): TextToSpeech {
  const provider = speechProvider(input);
  // avatar.json can name a default voice, model and options (speaking style) per provider
  const preset = avatar.manifest.voice?.[provider] ?? {};
  const cacheDir = carrier.ttsCacheDir ?? join(tmpdir(), "avatarscript-tts-cache");
  return createTts({ provider, model: preset.model, voice: input.voice ?? preset.voice, options: preset.options, cacheDir });
}

async function speak(input: ToolInput, carrier: ToolCarrier, dir: string): Promise<ToolResult> {
  if (input.script === undefined || input.script.trim() === "") return fail("speak needs `script`: what the avatar says. getGuide gives the syntax.");
  const script = parseScript(input.script);
  // A script from a model names no files on this computer: a background image or a font file would be read from it.
  const fileKey = FILE_KEYS.find((key) => FILE_VALUE.test(script.meta[key] ?? ""));
  if (fileKey !== undefined) return fail(`\`${fileKey}\` cannot be a file here: give a CSS colour for the background, or a font family for the subtitles.`);
  const avatar = await avatarAt(input.avatar, carrier);
  const audioName = "speech.wav";
  const { score, audio } = await compile(script, speech(input, carrier, avatar), {
    lang: script.meta.lang ?? detectLang(script.plain),
    subtitles: input.subtitles,
    audioName,
  });
  const audioPath = join(dir, audioName);
  const bytes = toWav(audio);
  await writeFile(audioPath, bytes);
  const job: Job = { kind: "speech", stem: input.fileName ?? "speech", score, audioPath, dir, audio: { bytes, mimeType: "audio/wav", pcm: audio } };
  return present(job, input, carrier, avatar);
}

const ACTIONS: Record<Exclude<ToolAction, "getGuide">, (input: ToolInput, carrier: ToolCarrier, dir: string) => Promise<ToolResult>> = { sing, speak };

/**
 * Runs one call of the tool. Whatever goes wrong (a path that is not there, a script that does not
 * parse, a missing key, a renderer that fails) comes back as text the model can act on.
 */
export async function manage(input: ToolInput, carrier: ToolCarrier = {}): Promise<ToolResult> {
  if (input.action === "getGuide") return { text: TOOL_GUIDE, isError: false };
  const dir = await mkdtemp(join(tmpdir(), "avatarscript-"));
  try {
    return await ACTIONS[input.action](input, carrier, dir);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A view's avatar: the one a performance names (an https URL), else the carrier's. As data, so a page can hand it to the mesh engine. */
export async function avatarForView(named: unknown, carrier: ToolCarrier = {}): Promise<AvatarAssets> {
  const url = AvatarUrlSchema.safeParse(named);
  if (!url.success) throw new Error("the avatar a view names must be an https URL");
  const avatar = await avatarAt(url.data, carrier);
  return { rig: avatar.rig, assets: avatar.assets };
}

/** A file stem from a performance's title, which a view sent back: only what a stem may hold. */
function stemOf(title: string): string {
  const stem = title.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "");
  return FILE_STEM.test(stem) ? stem : "avatar";
}

/**
 * The video of a performance, when the user wants a file: rendered now, kept by the carrier and
 * returned as `video`. The performance comes back from a view, so it is checked, and it may name
 * no file on this computer (a background image, a font).
 */
export async function renderPerformance(sent: unknown, carrier: ToolCarrier = {}): Promise<ToolResult> {
  const parsed = PerformanceSchema.safeParse(sent);
  if (!parsed.success) return fail(`That is not a performance this tool made:\n${z.prettifyError(parsed.error)}`);
  const performance = parsed.data;
  if (FILE_VALUE.test(performance.score.view.background) || FILE_VALUE.test(performance.score.subtitles?.font ?? ""))
    return fail("A performance may not name a file for its background or its subtitle font.");
  const type = AUDIO_DATA.exec(performance.audio)?.[1];
  const extension = AUDIO_TYPES.find(([, mimeType]) => mimeType === type)?.[0];
  if (extension === undefined) return fail("The performance's audio is of a kind this tool does not make.");
  const dir = await mkdtemp(join(tmpdir(), "avatarscript-"));
  try {
    // The name keeps the extension; the score's times already allow for an MP3's delay.
    const audioPath = join(dir, `audio${extension}`);
    await writeFile(audioPath, Buffer.from(performance.audio.slice(performance.audio.indexOf(",") + 1), "base64"));
    const job: VideoJob = {
      kind: performance.kind,
      stem: stemOf(performance.title),
      title: performance.title,
      score: performance.score,
      audioPath,
      dir,
      avatar: await avatarAt(performance.avatar, carrier),
      width: performance.width,
      height: performance.height,
      subtitles: performance.subtitles,
    };
    return await makeVideo(job, carrier);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
