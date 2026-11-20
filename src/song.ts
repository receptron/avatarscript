// A song rendered by JingleScript → a score: the avatar sings it. JingleScript writes a timing map
// beside its audio ("jinglescript-timing/1": when every note, beat and lyric syllable happens, in
// seconds, computed from its score). The lyric syllables are all a mouth needs, so nothing is
// aligned or synthesized here, and JingleScript itself is not a dependency: only the part of the
// timing map that is read is checked, and fields this does not know are ignored.
//
// Singing differs from speech in two ways the mouth shows. The vowel lands on the note (the
// consonant is sung just before it), and it is held for the note's whole length, however long,
// while a consonant stays as short as in speech. So the mouth is built from the syllables here,
// rather than by spreading the text over its time as for speech.
import { z } from "zod";
import { detectLang } from "./compile.ts";
import { textVisemes } from "./g2p/index.ts";
import { isKana, kanaMoras, VOWEL_VISEME, type Mora } from "./g2p/ja.ts";
import { check } from "./json.ts";
import type { Score } from "./score.ts";
import type { Emotion } from "./script.ts";
import type { Caption } from "./subtitles.ts";
import { resolveView, type ViewInput } from "./view.ts";
import { normalizeEvents, type VisemeEvent } from "./visemes.ts";

/** The timing map this reads. */
export const SONG_TIMING_FORMAT = "jinglescript-timing/1";

const SyllableSchema = z.object({ text: z.string(), t: z.number(), end: z.number() });
const LyricLineSchema = z.object({ track: z.number(), text: z.string(), t: z.number(), end: z.number(), syllables: z.array(SyllableSchema) });

/** What a song needs of a JingleScript timing map: its length and its lyrics. The rest (notes, beats, cues) is not read. */
export const SongTimingSchema = z.object({
  format: z.literal(SONG_TIMING_FORMAT),
  /** length of the audio, seconds */
  duration: z.number(),
  /** lines of lyrics with every syllable's time; absent when the score has none */
  lyrics: z.array(LyricLineSchema).optional(),
});
export type SongTiming = z.infer<typeof SongTimingSchema>;
type Syllable = z.infer<typeof SyllableSchema>;

const FormatSchema = z.object({ format: z.string() });

/** Checks a timing map read from a file; a format this does not read is named, with the one it does. */
export function parseSongTiming(value: unknown, where: string): SongTiming {
  const format = FormatSchema.safeParse(value).data?.format;
  if (format !== undefined && format !== SONG_TIMING_FORMAT)
    throw new Error(`${where} is a "${format}" file; a song needs a JingleScript timing map, "${SONG_TIMING_FORMAT}" (the timingFile of renderScore)`);
  return check(SongTimingSchema, value, where);
}

export interface SongOptions {
  /** language of the lyrics (default: detected from them) */
  lang?: string;
  /** recorded in the score as its audio file */
  audioName?: string;
  /**
   * How late the audio plays against the timing map, seconds: every time is moved by it. Default
   * `songAudioDelay(audioName)`: an MP3 from JingleScript starts 23 ms late, a WAV on time.
   */
  audioDelay?: number;
  /** the track whose lyrics are sung, when several have lyrics (default: the first that has any) */
  track?: number;
  /** the avatar's emotion for the song (default neutral) */
  emotion?: Emotion;
  /** background and avatar placement */
  view?: ViewInput;
}

/**
 * JingleScript's MP3 decodes 1105 samples late at 48 kHz (its encoder's delay; the file has no
 * header that says so), measured against its own WAV. Its WAV is exact.
 */
export const MP3_DELAY = 1105 / 48000;
export const songAudioDelay = (audioName: string | undefined): number => (audioName?.toLowerCase().endsWith(".mp3") ? MP3_DELAY : 0);

/** How long before its note a consonant shapes the mouth; lips that close (ま, ば, ぱ) a little longer. */
const CONSONANT = 0.07;
const LIPS = 0.1;
/** A silence at least this long after a syllable closes the mouth; a shorter one holds the vowel into the next. */
const REST = 0.12;
/** A consonant never starts sooner than this after the mouth shape before it, and lasts at least this long: one frame at 30 fps. */
const MIN_GAP = 0.034;

const ms = (t: number) => Math.round(t * 1000) / 1000;

/** The mouth of one mora sung from `s` to `e`: its consonant before `s`, never before `earliest`; nothing after `e`. */
function sungMora(mora: Mora, s: number, e: number, earliest: number): VisemeEvent[] {
  if (mora.kind === "q") return [[s, "sil"]];
  if (mora.kind === "n") return [[s, "nn"]];
  const vowel = VOWEL_VISEME[mora.vowel];
  if (!mora.onset) return [[s, vowel]];
  const lead = mora.onset === "PP" ? LIPS : CONSONANT;
  const at = Math.max(s - lead, earliest);
  if (at < s)
    return [
      [at, mora.onset],
      [s, vowel],
    ];
  // No room before the note: the consonant takes the note's first moment instead, when the note
  // is long enough to show the vowel after it; a shorter note shows its vowel only (a vowel put
  // after the note's end would stay open through the rest that follows).
  return s + MIN_GAP < e
    ? [
        [s, mora.onset],
        [s + MIN_GAP, vowel],
      ]
    : [[s, vowel]];
}

/** The mouth of one syllable: kana by the rules of singing, other text as speech spread over the note. */
async function syllableVisemes(syllable: Syllable, earliest: number): Promise<VisemeEvent[]> {
  const text = syllable.text.trim();
  const chars = Array.from(text);
  if (chars.length === 0) return [];
  if (!isKana(text)) {
    const step = (syllable.end - syllable.t) / chars.length;
    const events = await textVisemes(
      chars,
      chars.map((_, i) => ({ start: syllable.t + i * step, end: syllable.t + (i + 1) * step })),
    );
    // textVisemes closes the mouth at the end of its text; here the next syllable or the rest decides.
    return events.filter(([t, viseme]) => !(viseme === "sil" && t >= syllable.end));
  }
  const moras = kanaMoras(chars);
  const step = (syllable.end - syllable.t) / Math.max(1, moras.length);
  return moras.flatMap((mora, i) => sungMora(mora, syllable.t + i * step, syllable.t + (i + 1) * step, i === 0 ? earliest : syllable.t + (i - 0.5) * step));
}

/** The lyric lines that are sung: one track's, in order. */
function sungLines(timing: SongTiming, track: number | undefined): NonNullable<SongTiming["lyrics"]> {
  const lines = (timing.lyrics ?? []).filter((line) => line.syllables.length > 0);
  if (lines.length === 0)
    throw new Error("the timing map has no lyrics: there is nothing to sing (give the notes of the sung track a `lyric` in the JingleScript score)");
  const tracks = [...new Set(lines.map((line) => line.track))].sort((a, b) => a - b);
  const chosen = track ?? tracks[0];
  const sung = lines.filter((line) => line.track === chosen);
  if (sung.length === 0) throw new Error(`track ${String(track)} has no lyrics; tracks with lyrics: ${tracks.join(", ")}`);
  return sung.toSorted((a, b) => a.t - b.t);
}

/** The emotion comes this long before a line is sung, as before a spoken sentence. */
const EMOTION_LEAD = 0.15;

/**
 * The song's emotion from the start, and again before each line: the engine lets an emotion go a
 * moment after the avatar stops singing, so a line after a long rest would be sung without it.
 */
function emotionCues(lineTimes: number[], emotion: Emotion): Score["cues"] {
  return [...new Set([0, ...lineTimes])].toSorted((a, b) => a - b).map((t) => ({ t, emotion }));
}

/**
 * A score in which the avatar sings a JingleScript song: its mouth follows the lyric syllables of
 * the timing map, each lyric line is a caption, and the avatar "speaks" (moves with the sound)
 * during the lines only. Render it with the song's audio file as `audioPath`.
 */
export async function compileSong(timing: SongTiming, options: SongOptions = {}): Promise<Score> {
  const lines = sungLines(timing, options.track);
  const delay = options.audioDelay ?? songAudioDelay(options.audioName);
  const syllables = lines.flatMap((line) => line.syllables);
  const visemes: VisemeEvent[] = [];
  let earliest = 0;
  for (const [i, syllable] of syllables.entries()) {
    const events = await syllableVisemes(syllable, earliest);
    visemes.push(...events);
    const next = syllables.at(i + 1);
    if (next === undefined || next.t - syllable.end >= REST) visemes.push([syllable.end, "sil"]);
    earliest = Math.max(syllable.t, ...events.map(([t]) => t)) + MIN_GAP;
  }
  const shifted = (t: number) => ms(Math.min(timing.duration, Math.max(0, t + delay)));
  const captions: Caption[] = lines.map((line) => ({ start: shifted(line.t), end: shifted(line.end), text: line.text.trim() }));
  const lyrics = lines.map((line) => line.text).join("\n");
  return {
    format: "avatarscript-score/1",
    lang: options.lang ?? detectLang(lyrics),
    audio: options.audioName ?? "song.mp3",
    duration: ms(timing.duration),
    visemes: normalizeEvents(visemes.map(([t, viseme]): VisemeEvent => [shifted(t), viseme])),
    speaking: lines.map((line) => [shifted(line.t - LIPS), shifted(line.end)]),
    cues: emotionCues(
      lines.map((line) => shifted(line.t - EMOTION_LEAD)),
      options.emotion ?? "neutral",
    ),
    captions,
    subtitles: null,
    view: resolveView(undefined, options.view),
    provenance: { tts: { provider: "jinglescript", timing: SONG_TIMING_FORMAT, audioDelay: ms(delay) } },
  };
}
