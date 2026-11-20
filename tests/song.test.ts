import { describe, expect, it } from "vitest";
import { compileSong, MP3_DELAY, parseSongTiming, songAudioDelay, type SongTiming } from "../src/song.ts";
import { visemeAt } from "../src/visemes.ts";

/** A JingleScript timing map with the lyrics given, and the fields a song does not read. */
function timingMap(lines: { track?: number; syllables: [text: string, t: number, end: number][] }[], duration = 10): unknown {
  return {
    format: "jinglescript-timing/1",
    tempo: 120,
    duration,
    cues: {},
    beats: [0, 0.5],
    notes: [{ t: 0.5, track: 0, instrument: "organ", vel: 0.8, pitch: "E4" }],
    audibleUntil: duration - 0.2,
    lyrics: lines.map((line, i) => ({
      track: line.track ?? 0,
      line: i,
      text: line.syllables.map(([text]) => text).join(""),
      t: line.syllables[0][1],
      end: line.syllables.at(-1)?.[2] ?? 0,
      syllables: line.syllables.map(([text, t, end]) => ({ text, t, end })),
    })),
  };
}
const song = (lines: Parameters<typeof timingMap>[0], duration?: number): SongTiming => parseSongTiming(timingMap(lines, duration), "test");

describe("parseSongTiming", () => {
  it("reads a JingleScript timing map, ignoring what a song does not need", () => {
    const timing = song([{ syllables: [["あ", 1, 2]] }]);
    expect(timing).toEqual({
      format: "jinglescript-timing/1",
      duration: 10,
      lyrics: [{ track: 0, text: "あ", t: 1, end: 2, syllables: [{ text: "あ", t: 1, end: 2 }] }],
    });
  });

  it("names a file of another format, and what is wrong with a broken one", () => {
    expect(() => parseSongTiming({ format: "jinglescript-timing/2", duration: 1 }, "song.timing.json")).toThrow(
      'song.timing.json is a "jinglescript-timing/2" file; a song needs a JingleScript timing map, "jinglescript-timing/1"',
    );
    expect(() => parseSongTiming({ format: "jinglescript-timing/1" }, "song.timing.json")).toThrow("song.timing.json is not valid");
  });
});

describe("compileSong", () => {
  it("puts each vowel on its note, its consonant just before, and holds the vowel for the note", async () => {
    // あ on 1.0, さ on 1.5 held for 2 s, then a rest
    const score = await compileSong(
      song([
        {
          syllables: [
            ["あ", 1, 1.5],
            ["さ", 1.5, 3.5],
          ],
        },
      ]),
      { audioDelay: 0 },
    );
    expect(score.visemes).toEqual([
      [1, "aa"],
      [1.43, "SS"],
      [1.5, "aa"],
      [3.5, "sil"],
    ]);
    // the long note keeps the mouth open: the consonant does not grow with it
    expect(visemeAt(score.visemes, 3.4)).toBe("aa");
    expect(score.duration).toBe(10);
    expect(score.lang).toBe("ja");
  });

  it("closes the mouth for a rest, and holds the vowel across a shorter gap", async () => {
    const score = await compileSong(
      song([
        {
          syllables: [
            ["お", 1, 1.4],
            ["い", 1.45, 2],
            ["え", 2.5, 3],
          ],
        },
      ]),
      { audioDelay: 0 },
    );
    expect(score.visemes).toEqual([
      [1, "oh"],
      [1.45, "ih"],
      [2, "sil"],
      [2.5, "E"],
      [3, "sil"],
    ]);
  });

  it("closes the lips a little longer for ま, hums ん, stops for っ, and keeps a consonant after the last mouth shape", async () => {
    const score = await compileSong(
      song([
        {
          syllables: [
            ["ま", 1, 1.5],
            ["ん", 1.5, 2],
            ["っ", 2, 2.2],
            ["か", 2.2, 2.5],
            ["と", 2.52, 3],
          ],
        },
      ]),
      { audioDelay: 0 },
    );
    expect(score.visemes).toEqual([
      [0.9, "PP"],
      [1, "aa"],
      [1.5, "nn"],
      [2, "sil"],
      [2.13, "kk"],
      [2.2, "aa"],
      [2.45, "DD"],
      [2.52, "oh"],
      [3, "sil"],
    ]);
    // no room before a note that follows at once: the consonant takes the note's first moment
    const tight = await compileSong(
      song([
        {
          syllables: [
            ["あ", 1, 1.02],
            ["か", 1.02, 2],
          ],
        },
      ]),
      { audioDelay: 0 },
    );
    expect(tight.visemes).toEqual([
      [1, "aa"],
      [1.02, "kk"],
      [1.054, "aa"],
      [2, "sil"],
    ]);
    // too short even for that: the vowel alone, and the mouth closes for the rest after it
    const brief = await compileSong(
      song([
        {
          syllables: [
            ["あ", 1, 1.02],
            ["か", 1.02, 1.04],
          ],
        },
      ]),
      { audioDelay: 0 },
    );
    expect(brief.visemes).toEqual([
      [1, "aa"],
      [1.04, "sil"],
    ]);
    const alone = await compileSong(song([{ syllables: [["か", 0, 0.02]] }]), { audioDelay: 0 });
    expect(alone.visemes).toEqual([
      [0, "aa"],
      [0.02, "sil"],
    ]);
  });

  it("moves every time by the audio's delay: 23 ms for JingleScript's MP3, none for its WAV", async () => {
    const timing = song([{ syllables: [["あ", 1, 2]] }]);
    expect(songAudioDelay("song.MP3")).toBe(MP3_DELAY);
    expect(songAudioDelay("song.wav")).toBe(0);
    const mp3 = await compileSong(timing, { audioName: "song.mp3" });
    expect(mp3.visemes).toEqual([
      [1.023, "aa"],
      [2.023, "sil"],
    ]);
    expect(mp3.captions).toEqual([{ start: 1.023, end: 2.023, text: "あ" }]);
    expect(mp3.provenance.tts).toEqual({ provider: "jinglescript", timing: "jinglescript-timing/1", audioDelay: 0.023 });
    expect((await compileSong(timing, { audioName: "song.wav" })).visemes[0]).toEqual([1, "aa"]);
  });

  it("captions each lyric line, speaks during the lines only, and sets the emotion", async () => {
    const score = await compileSong(
      song([
        {
          syllables: [
            ["あ ", 1, 1.5],
            ["さ", 1.5, 2],
          ],
        },
        { syllables: [["よ", 4, 5]] },
      ]),
      { audioDelay: 0, emotion: "happy" },
    );
    expect(score.captions).toEqual([
      { start: 1, end: 2, text: "あ さ" },
      { start: 4, end: 5, text: "よ" },
    ]);
    expect(score.speaking).toEqual([
      [0.9, 2],
      [3.9, 5],
    ]);
    // the emotion from the start, and again just before each line: the engine lets it go in a long rest
    expect(score.cues).toEqual([
      { t: 0, emotion: "happy" },
      { t: 0.85, emotion: "happy" },
      { t: 3.85, emotion: "happy" },
    ]);
    // a line at the very start does not repeat the cue at 0
    expect((await compileSong(song([{ syllables: [["あ", 0.1, 1]] }]), { audioDelay: 0 })).cues).toEqual([{ t: 0, emotion: "neutral" }]);
    expect(score.audio).toBe("song.mp3");
  });

  it("sings other text as speech spread over its note", async () => {
    const score = await compileSong(song([{ syllables: [["la ", 1, 2]] }]), { audioDelay: 0 });
    expect(score.lang).toBe("en");
    expect(score.visemes.at(0)?.[0]).toBe(1);
    expect(score.visemes.some(([, viseme]) => viseme === "aa")).toBe(true);
    expect(score.visemes.at(-1)).toEqual([2, "sil"]);
  });

  it("sings one track's lyrics: the first that has any, or the one named", async () => {
    const timing = song([
      { track: 2, syllables: [["あ", 1, 2]] },
      { track: 1, syllables: [["い", 3, 4]] },
    ]);
    expect((await compileSong(timing, { audioDelay: 0 })).captions).toEqual([{ start: 3, end: 4, text: "い" }]);
    expect((await compileSong(timing, { audioDelay: 0, track: 2 })).captions).toEqual([{ start: 1, end: 2, text: "あ" }]);
    await expect(compileSong(timing, { track: 0 })).rejects.toThrow("track 0 has no lyrics; tracks with lyrics: 1, 2");
  });

  it("says there is nothing to sing when the timing map has no lyrics", async () => {
    await expect(compileSong(parseSongTiming({ format: "jinglescript-timing/1", duration: 3 }, "test"))).rejects.toThrow("the timing map has no lyrics");
  });
});
