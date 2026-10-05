// AvatarScript (.avs) parser: the text to speak with inline direction.
//
//   [emotion:happy] Hello!<nod> [pause:300ms] This is *really* important.
//
// Offsets count characters (code points) of the plain spoken text.

export const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'relaxed'] as const;
export type Emotion = typeof EMOTIONS[number];

export type Cue =
  | { offset: number; motion: string }
  | { offset: number; emphasis: true }
  | { offset: number; gaze: string };

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

const GAZE = /^(camera|left|right|up|down|-?\d*\.?\d+,-?\d*\.?\d+)$/;

function parseDuration(v: string, line: number): number {
  const m = /^(\d*\.?\d+)(ms|s)$/.exec(v);
  if (!m) throw new ScriptError(`pause must look like 300ms or 1.5s, got "${v}"`, line);
  return Number(m[1]) / (m[2] === 'ms' ? 1000 : 1);
}

/** Plain text with no markup: one neutral segment. */
export function plainScript(text: string, meta: Record<string, string> = {}): Script {
  const chars = Array.from(text);
  const lead = chars.length - Array.from(text.trimStart()).length;
  const trimmed = text.trim();
  return {
    meta, plain: text, cues: [], pauseAfter: 0,
    segments: trimmed ? [{ text: trimmed, offset: lead, emotion: 'neutral', pauseBefore: 0 }] : [],
  };
}

export function parseScript(source: string): Script {
  const meta: Record<string, string> = {};
  let body = source.replace(/\r\n?/g, '\n');
  let line = 1;
  const front = /^---\n([\s\S]*?)\n---\n?/.exec(body);
  if (front) {
    for (const raw of front[1].split('\n')) {
      const m = /^\s*([\w-]+)\s*:\s*(.*?)\s*$/.exec(raw);
      if (m) meta[m[1]] = m[2];
      else if (raw.trim()) throw new ScriptError(`front matter lines must be "key: value"`, line + 1);
      line++;
    }
    line += 2;
    body = body.slice(front[0].length);
  }

  const plain: string[] = [];
  const cues: Cue[] = [];
  const segments: Segment[] = [];
  let emotion: Emotion = 'neutral';
  let segStart = 0, pause = 0, inEmphasis = false;

  const closeSegment = () => {
    const raw = plain.slice(segStart).join('');
    const text = raw.trim();
    if (text) {
      const lead = Array.from(raw).length - Array.from(raw.trimStart()).length;
      segments.push({ text, offset: segStart + lead, emotion, pauseBefore: pause });
      pause = 0;
    }
    segStart = plain.length;
  };

  const chars = Array.from(body);
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === '\n') line++;
    if (c === '\\') {
      if (i + 1 >= chars.length) throw new ScriptError('"\\" at the end of the script', line);
      plain.push(chars[++i]);
      continue;
    }
    if (c === '[') {
      const end = chars.indexOf(']', i);
      if (end < 0) throw new ScriptError('"[" without a closing "]"', line);
      const content = chars.slice(i + 1, end).join('').trim();
      i = end;
      if (!content) throw new ScriptError('empty tag "[]"', line);
      for (const item of content.split(/\s+/)) {
        const m = /^([a-z]+):(.+)$/.exec(item);
        if (!m) throw new ScriptError(`tags are written [key:value], got "${item}"`, line);
        const [, key, value] = m;
        if (key === 'emotion') {
          if (!(EMOTIONS as readonly string[]).includes(value)) throw new ScriptError(`unknown emotion "${value}" (use ${EMOTIONS.join(', ')})`, line);
          if (value !== emotion) { closeSegment(); emotion = value as Emotion; }
        } else if (key === 'pause') {
          closeSegment();
          pause += parseDuration(value, line);
        } else if (key === 'gaze') {
          if (!GAZE.test(value)) throw new ScriptError(`gaze must be camera, left, right, up, down or x,y, got "${value}"`, line);
          cues.push({ offset: plain.length, gaze: value });
        } else throw new ScriptError(`unknown tag "${key}" (use emotion, pause, gaze)`, line);
      }
      continue;
    }
    if (c === '<') {
      const end = chars.indexOf('>', i);
      if (end < 0) throw new ScriptError('"<" without a closing ">"', line);
      const name = chars.slice(i + 1, end).join('').trim();
      if (!/^[A-Za-z][\w-]*$/.test(name)) throw new ScriptError(`motion names are letters, digits, "-" and "_", got "<${name}>"`, line);
      cues.push({ offset: plain.length, motion: name });
      i = end;
      continue;
    }
    if (c === '*') {
      if (!inEmphasis) cues.push({ offset: plain.length, emphasis: true });
      inEmphasis = !inEmphasis;
      continue;
    }
    plain.push(c);
  }
  if (inEmphasis) throw new ScriptError('"*" emphasis is not closed', line);
  closeSegment();
  return { meta, plain: plain.join(''), segments, cues, pauseAfter: pause };
}
