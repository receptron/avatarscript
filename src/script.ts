// AvatarScript (.avs) parser: the text to speak with inline direction.
//
//   [emotion:happy] Hello!<nod> [pause:300ms] This is *really* important.
//
// Offsets count characters (code points) of the plain spoken text.

export const EMOTIONS = ["neutral", "happy", "sad", "angry", "surprised", "relaxed"] as const;
export type Emotion = (typeof EMOTIONS)[number];
export const isEmotion = (v: string): v is Emotion => EMOTIONS.some((e) => e === v);

export type Cue = { offset: number; motion: string } | { offset: number; emphasis: true } | { offset: number; gaze: string };

export interface Segment {
  /** spoken text sent to the TTS, trimmed */
  text: string;
  /** offset of `text` in the plain text */
  offset: number;
  emotion: Emotion;
  /** silence before this segment, seconds */
  pauseBefore: number;
}

export interface Script {
  meta: Record<string, string>;
  /** all spoken text, markup removed */
  plain: string;
  segments: Segment[];
  cues: Cue[];
  /** silence after the last segment, seconds */
  pauseAfter: number;
}

export class ScriptError extends Error {
  constructor(message: string, line: number) {
    super(`line ${line}: ${message}`);
  }
}

const GAZE_WORDS = new Set(["camera", "left", "right", "up", "down"]);
const DECIMAL = /^-?[\d.]+$/;
const KEY = /^[\w-]+$/;
const TAG_KEY = /^[a-z]+$/;
const MOTION_NAME = /^[A-Za-z][\w-]*$/;

const isDecimal = (s: string) => DECIMAL.test(s) && Number.isFinite(Number(s));
const isGaze = (v: string) => GAZE_WORDS.has(v) || (v.split(",").length === 2 && v.split(",").every(isDecimal));

function parseDuration(v: string, line: number): number {
  let unit = "";
  if (v.endsWith("ms")) unit = "ms";
  else if (v.endsWith("s")) unit = "s";
  const value = v.slice(0, v.length - unit.length);
  if (!unit || !isDecimal(value) || value.startsWith("-")) throw new ScriptError(`pause must look like 300ms or 1.5s, got "${v}"`, line);
  return Number(value) / (unit === "ms" ? 1000 : 1);
}

/** Plain text with no markup: one neutral segment. */
export function plainScript(text: string, meta: Record<string, string> = {}): Script {
  const chars = Array.from(text);
  const lead = chars.length - Array.from(text.trimStart()).length;
  const trimmed = text.trim();
  return {
    meta,
    plain: text,
    cues: [],
    pauseAfter: 0,
    segments: trimmed ? [{ text: trimmed, offset: lead, emotion: "neutral", pauseBefore: 0 }] : [],
  };
}

/** `---` front matter of `key: value` lines, if the script starts with one. */
function readFrontMatter(source: string): { meta: Record<string, string>; body: string; line: number } {
  const lines = source.split("\n");
  const end = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  if (end < 0) return { meta: {}, body: source, line: 1 };
  const meta: Record<string, string> = {};
  lines.slice(1, end).forEach((raw, i) => {
    if (!raw.trim()) return;
    const colon = raw.indexOf(":");
    const key = raw.slice(0, colon).trim();
    if (colon < 0 || !KEY.test(key)) throw new ScriptError(`front matter lines must be "key: value"`, i + 2);
    meta[key] = raw.slice(colon + 1).trim();
  });
  return { meta, body: lines.slice(end + 1).join("\n"), line: end + 2 };
}

interface State {
  chars: string[];
  plain: string[];
  cues: Cue[];
  segments: Segment[];
  emotion: Emotion;
  segStart: number;
  pause: number;
  inEmphasis: boolean;
  line: number;
}

function closeSegment(s: State) {
  const raw = s.plain.slice(s.segStart).join("");
  const text = raw.trim();
  if (text) {
    const lead = Array.from(raw).length - Array.from(raw.trimStart()).length;
    s.segments.push({ text, offset: s.segStart + lead, emotion: s.emotion, pauseBefore: s.pause });
    s.pause = 0;
  }
  s.segStart = s.plain.length;
}

/** The text between chars[at] and the next `close`, and the index of that `close`. */
function enclosed(s: State, at: number, close: string): { content: string; end: number } {
  const end = s.chars.indexOf(close, at);
  if (end < 0) throw new ScriptError(`"${s.chars[at]}" without a closing "${close}"`, s.line);
  return {
    content: s.chars
      .slice(at + 1, end)
      .join("")
      .trim(),
    end,
  };
}

function applyTagItem(s: State, item: string) {
  const colon = item.indexOf(":");
  const key = item.slice(0, colon);
  const value = item.slice(colon + 1);
  if (colon < 0 || !TAG_KEY.test(key) || !value) throw new ScriptError(`tags are written [key:value], got "${item}"`, s.line);
  if (key === "emotion") {
    if (!isEmotion(value)) throw new ScriptError(`unknown emotion "${value}" (use ${EMOTIONS.join(", ")})`, s.line);
    if (value !== s.emotion) {
      closeSegment(s);
      s.emotion = value;
    }
  } else if (key === "pause") {
    closeSegment(s);
    s.pause += parseDuration(value, s.line);
  } else if (key === "gaze") {
    if (!isGaze(value)) throw new ScriptError(`gaze must be camera, left, right, up, down or x,y, got "${value}"`, s.line);
    s.cues.push({ offset: s.plain.length, gaze: value });
  } else {
    throw new ScriptError(`unknown tag "${key}" (use emotion, pause, gaze)`, s.line);
  }
}

// Each markup character reads its markup starting at index `at` and returns the next index.
const MARKUP: Record<string, (s: State, at: number) => number> = {
  "\\": (s, at) => {
    if (at + 1 >= s.chars.length) throw new ScriptError('"\\" at the end of the script', s.line);
    s.plain.push(s.chars[at + 1]);
    return at + 2;
  },
  "[": (s, at) => {
    const { content, end } = enclosed(s, at, "]");
    if (!content) throw new ScriptError('empty tag "[]"', s.line);
    for (const item of content.split(/\s+/)) applyTagItem(s, item);
    return end + 1;
  },
  "<": (s, at) => {
    const { content, end } = enclosed(s, at, ">");
    if (!MOTION_NAME.test(content)) throw new ScriptError(`motion names are letters, digits, "-" and "_", got "<${content}>"`, s.line);
    s.cues.push({ offset: s.plain.length, motion: content });
    return end + 1;
  },
  "*": (s, at) => {
    if (!s.inEmphasis) s.cues.push({ offset: s.plain.length, emphasis: true });
    s.inEmphasis = !s.inEmphasis;
    return at + 1;
  },
};

export function parseScript(source: string): Script {
  const front = readFrontMatter(source.replace(/\r\n?/g, "\n"));
  const s: State = {
    chars: Array.from(front.body),
    plain: [],
    cues: [],
    segments: [],
    emotion: "neutral",
    segStart: 0,
    pause: 0,
    inEmphasis: false,
    line: front.line,
  };
  let at = 0;
  while (at < s.chars.length) {
    const c = s.chars[at];
    const markup = Object.hasOwn(MARKUP, c) ? MARKUP[c] : undefined;
    if (markup) {
      at = markup(s, at);
      continue;
    }
    if (c === "\n") s.line++;
    s.plain.push(c);
    at++;
  }
  if (s.inEmphasis) throw new ScriptError('"*" emphasis is not closed', s.line);
  closeSegment(s);
  return { meta: front.meta, plain: s.plain.join(""), segments: s.segments, cues: s.cues, pauseAfter: s.pause };
}
