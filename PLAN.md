# AvatarScript — Plan

AvatarScript turns **an avatar + text** into **a lip-synced, acted video**:

```
avatar package + text ──► LLM ──► AvatarScript (.avs) ──► compiler ──► TTS ──► score.json ──► render ──► video.mp4
```

It has three parts:

1. **A standard avatar package** (`avatar.json`): what any avatar must declare so it can be
   driven without knowing how it is built.
2. **A script language** (`.avs`): the user's text, annotated with emotion, gestures, gaze,
   pauses and emphasis. An LLM writes it; people can edit it.
3. **A compiler and renderer**: it synthesizes speech, resolves the script against the speech
   timing into a timed **score**, and renders the avatar frame by frame into a video.

The first runtime is the mesh avatar engine from
[mesh-avatar-studio](https://github.com/shinshin86/mesh-avatar-studio), which already turns a single illustration into
a 2D mesh avatar with blinking, head motion, expressions and vowel mouths.

## Goals

- Any compliant avatar can say any text in any language, with matching mouth movements.
- The LLM decides the *performance* (emotion, gestures, gaze, emphasis); deterministic code
  decides the *timing*. LLMs are not asked to produce timestamps.
- Every step leaves a reviewable, editable file: script, score, audio, video.
- Rendering is reproducible: the same score, seed and avatar give the same video.
- Once it works well, AvatarScript is incorporated into
  [MulmoCast](https://github.com/receptron/mulmocast-cli) (see
  [MulmoCast integration](#mulmocast-integration)). It is therefore built as a Node library
  first; the CLI is a thin wrapper.

## Non-goals for v1

- Audio input (voice recordings). The main case is text-to-speech.
- TTS providers without timing data (OpenAI, Gemini). They need forced alignment, which comes
  in milestone 6.
- Real-time / streaming playback. v1 renders offline.
- 3D avatars. The package format leaves room for them, but only the mesh runtime is built.

## Design principles

- **Standardize the control interface, not the rig.** `rig.json` is internal to the mesh
  engine. What every avatar shares is the vocabulary used to drive it: emotions, visemes,
  gaze, head/body angles and named motions. Names follow VRM 1.0 expression presets where
  they exist.
- **Language-specific code stops at phonemes.** Text and timing become IPA phonemes; from
  there, visemes and avatar control are the same for every language.
- **The user's words are spoken unchanged.** The compiler rejects a script whose plain text
  differs from the input.

## 1. Avatar package

An avatar is a folder with `avatar.json` and runtime-specific assets.

```json
{
  "format": "avatarscript-avatar/1",
  "name": "Miko (qipao)",
  "runtime": "mesh-avatar/1",
  "assets": {
    "rig": "rig.json",
    "layers": "built/layers.json",
    "sprites": "built/sprites/sprites.json"
  },
  "capabilities": {
    "emotions": ["neutral", "happy", "sad", "angry", "surprised", "relaxed"],
    "motions": ["nod", "tilt", "think", "giggle", "surprise", "sigh", "no", "sway"],
    "gaze": true,
    "hand": true,
    "visemeTier": 1
  },
  "limits": { "angleX": [-30, 30], "angleY": [-30, 30], "angleZ": [-30, 30] },
  "voice": {
    "elevenlabs": {
      "voiceId": "…",
      "model": "eleven_v3",
      "emotionTags": { "happy": "[happy]", "sad": "[sad]" }
    }
  },
  "license": { "attribution": "…", "terms": "…" }
}
```

- `capabilities` is the menu given to the LLM and the list the compiler checks against.
- `limits` lets the compiler clamp requests a single-illustration avatar cannot show.
- `voice` binds a default voice per TTS provider; `emotionTags` overrides the provider's
  default emotion mapping.
- `license` is carried into the render's metadata. The bundled Miko sample has usage terms
  that must travel with it.
- API keys never appear here (see [Keys and privacy](#keys-and-privacy)).

### Standard controls

| Group | Names | Notes |
|---|---|---|
| Emotions | `neutral happy sad angry surprised relaxed` | VRM 1.0 presets; also the AITuber OnAir tags the mesh engine already supports |
| Visemes | `sil PP FF TH DD kk CH SS nn RR aa E ih oh ou` | The 15-viseme set used by Oculus/Meta lip sync |
| Gaze | `camera left right up down` or `x,y` in −1..1 | |
| Head / body | `angleX angleY angleZ bodyAngleX bodyAngleZ` (degrees) | Same names as the mesh engine parameters |
| Motions | Free names, declared per avatar | A shared core (`nod tilt think`) is recommended |

### Viseme tiers

Each avatar declares how many mouth shapes it can show. The compiler maps the 15 visemes down
to what the avatar has.

| Tier | Avatar has | Mapping |
|---|---|---|
| 0 | Mesh mouth only | Every viseme → (`mouthOpen`, `mouthForm`) from the table below |
| 1 | Drawn a/i/u/e/o mouths | Vowels use drawings; consonants use the nearest vowel or closed |
| 2 | Tier 1 + drawn PP, FF, TH, CH | Full set |

Tier 0 values. The vowels come from the mesh engine's `kana.js`; the consonant values are
starting points to tune visually.

| Viseme | open | form (−1 wide … +1 round) |
|---|---|---|
| sil, PP | 0 | keep previous |
| aa | 0.90 | 0 |
| E | 0.62 | −0.40 |
| ih | 0.50 | −0.85 |
| oh | 0.75 | 0.60 |
| ou | 0.40 | 0.90 |
| FF | 0.15 | −0.30 |
| TH | 0.25 | −0.20 |
| DD, nn | 0.25 | −0.25 |
| kk | 0.35 | −0.20 |
| SS | 0.20 | −0.60 |
| CH | 0.30 | 0.50 |
| RR | 0.30 | 0.40 |

The Miko sample is tier 1 (`mouth_a`, `mouth_i`, `mouth_o`, …), so it works on day one.

## 2. Script language (`.avs`)

The script is the user's text with inline markup. Tags use English keywords; the text stays in
its own language.

```text
---
lang: ja
provider: elevenlabs
---
[emotion:happy] みなさん、こんにちは！<nod> [pause:300ms]
今日は*とても*大事な話があります。
[emotion:surprised] え、本当に？<surprise>
[emotion:neutral gaze:left] では、始めましょう。
```

| Syntax | Meaning | Affects |
|---|---|---|
| `[emotion:NAME]` | Emotion from here on; starts a new TTS segment | face + voice style |
| `[gaze:DIR]` | Gaze from here on | face |
| `[pause:300ms]` / `[pause:1.2s]` | Silence; segment boundary | audio + idle avatar |
| `[a:x b:y]` | Several state changes in one tag | |
| `<motion>` | Play a named motion, starting at the next character | body/face |
| `*text*` | Emphasis: guaranteed head beat; voice emphasis where the provider allows | face (+ voice) |
| `\[ \< \* \\` | Literal characters | |
| Front matter | `lang`, `provider`, optional `voice`, `seed` | compiler |

Rules:

- **Unchanged text.** Removing the markup (and front matter) must give exactly the input text,
  ignoring only whitespace at tag boundaries. Otherwise the compiler rejects the script.
- **Unknown names are errors.** Emotions, motions and gaze directions must be in the avatar's
  `capabilities`.
- **Anchors are character offsets** in the plain text. This works for languages without
  spaces (Japanese, Chinese, Thai).
- Our tags are always `key:value` or `<name>`. Provider tags such as ElevenLabs' `[happy]` are
  never written in the script; the compiler adds them per segment.

## 3. Score (`score.json`)

The compiled result: everything the renderer needs, with all times resolved.

```json
{
  "format": "avatarscript-score/1",
  "avatar": "avatar.json",
  "audio": "voice.wav",
  "lang": "ja",
  "fps": 30,
  "duration": 12.4,
  "seed": 42,
  "visemes": [[0.12, "aa", 0.8], [0.26, "ih", 0.5]],
  "cues": [
    { "t": 0.10, "emotion": "happy" },
    { "t": 0.95, "motion": "nod" },
    { "t": 4.20, "emphasis": 1 },
    { "t": 9.80, "gaze": "left" }
  ],
  "provenance": {
    "provider": "elevenlabs", "model": "eleven_v3", "voice": "…",
    "timing": "provider-characters", "script": "hello.avs"
  }
}
```

The score depends on the avatar's control vocabulary, not on the mesh engine. A score can
also be written by hand, which is how the renderer is tested before TTS exists.

## 4. TTS and timing

### Adapter interface

```ts
interface TtsAdapter {
  id: string;                         // 'elevenlabs' in v1
  caps: {
    timing: 'viseme' | 'char' | 'none';
    style: 'tags' | 'instructions' | 'styleId' | 'none';
    maxChars: number;
  };
  synthesize(segment: {
    text: string;
    lang: string;
    voice: string;
    emotion: string;
    context?: { prev?: string; next?: string };
  }): Promise<{ pcm: Float32Array; sampleRate: number; timing?: CharTiming[] }>;
}
interface CharTiming { index: number; start: number; end: number } // index into segment text
```

### v1 provider: ElevenLabs

- Endpoint: `POST /v1/text-to-speech/{voice_id}/with-timestamps`, which returns audio plus
  per-character start/end times.
- One request per segment (segments split at emotion changes and pauses), passing
  `previous_text` / `next_text` for smooth delivery across segments.
- Emotion: the v3 audio tag (e.g. `[happy]`) is added at the start of the segment text.
- **To verify first:** whether character alignment includes the added tag characters, and
  whether to use `alignment` or `normalized_alignment` (numbers, abbreviations). Timings must
  map back to offsets in the user's text.

### Pipeline

1. Split the plain text into segments; synthesize each.
2. Resample to one rate, mono; join segments, inserting exact silence for `[pause]`.
3. Shift each segment's character times by its start time → times for the whole text.
4. Text → IPA phonemes per word (G2P), spread across the word's time span: vowels get more
   time than consonants, and `ー`/long vowels extend.
5. IPA → viseme (one shared table), then map to the avatar's tier.
6. Resolve script anchors (character offsets) to times → cues.
7. Write `voice.wav` and `score.json`.

### Text → phonemes (G2P)

| Language | v1 approach |
|---|---|
| Japanese | Readings from a morphological analyzer (e.g. kuromoji.js) → kana → the mora rules from `kana.js` |
| Most others | espeak-ng (via its CLI or a WebAssembly build) → IPA |
| Chinese | To be decided (pinyin → IPA) |

A Japanese kanji gets the time span of that character; its reading's moras are spread inside it.

## 5. Rendering

- Headless Chromium through Puppeteer, which MulmoCast already uses, so integration adds no
  second browser dependency. (mesh-avatar-studio's own tools use Playwright; either drives the
  same WebGL page.)
- The avatar is created with `manual: true`; each frame calls `advance(1 / fps)` after applying
  the cues due by that time.
- Frames are read as raw RGBA (`gl.readPixels`) and piped to ffmpeg (`-f rawvideo`), which
  also muxes `voice.wav`. This avoids a PNG encode per frame.
- Output: `video.mp4` (H.264 + AAC); optional transparent output (ProRes 4444 or WebM VP9 with
  alpha) for compositing.

### Changes needed in the mesh engine

These go to mesh-avatar-studio as pull requests.

1. **Seeded randomness.** `motion.js` uses `Math.random()` for blink timing, breathing period,
   glances, auto motions and the loudness vowel. Add a `seed` option and a seeded generator.
   The 0 px deformation regression must still pass.
2. **`setMouth(viseme | null, weight)`.** Explicit mouth input through the same smoothing path
   as `holdMouth`, choosing drawn mouths per the avatar's tier.
3. **`setGaze(x, y)`** as an expression-level gaze offset (today only expressions set `glance`).
4. **An emphasis beat.** A short additive head-dip motion (like `nod`, smaller and faster).
5. **Score player.** Applies cues at their times during `advance()`: `setEmotion(tag,
   { playMotion: false })`, `play(id)`, `setGaze`, `setMouth`. It uses the engine's existing
   layering (expressions, motions, springs), so the follow-through stays.

## 6. LLM step

- Input: the plain text, `lang`, the avatar's `capabilities`, and short guidance on pacing
  (e.g. at most one motion per sentence, emotions change at sentence boundaries).
- Output: a `.avs` script.
- Validation: parse, check names and the unchanged-text rule. On failure, retry once with the
  error message; then fail with the error.
- Model: configurable; default to the latest Claude model.
- The step is optional: a user can write `.avs` by hand and skip it.

## 7. CLI

```sh
avatarscript script  --avatar ../mesh-avatar-studio/projects/miko --text hello.txt   # → hello.avs
avatarscript compile --avatar … hello.avs --tts elevenlabs                            # → voice.wav, score.json
avatarscript render  --avatar … score.json -o hello.mp4                               # → video
avatarscript make    --avatar … --text hello.txt --tts elevenlabs -o hello.mp4        # all three
```

- Audio is cached per segment, keyed by a hash of (provider, model, voice, emotion, text,
  context). Editing a motion re-renders without new TTS requests; editing one sentence
  re-synthesizes only that segment.
- `--dry-run` prints segments and the requests that would be sent.

## Keys and privacy

- API keys only from the environment: `ELEVENLABS_API_KEY`, `ANTHROPIC_API_KEY` (later
  `OPENAI_API_KEY`, `GEMINI_API_KEY`). Never written to scripts, scores or manifests.
- Only the text (and its segment context) is sent to the TTS provider; the LLM step sends text
  plus the capability list. Avatar images and rig data are never sent anywhere.
- The provider is always chosen explicitly (`--tts`); nothing defaults to a cloud service.
- Avatar projects stay where they are (mesh-avatar-studio's ignored `projects/`). Outputs go to
  the folder given by `-o`. Do not commit user avatars, audio or videos.

## MulmoCast integration

MulmoCast turns a MulmoScript (a JSON list of *beats*, each with a speaker and text) into a
podcast or video. It already synthesizes speech per beat (OpenAI by default; also Google,
Gemini, ElevenLabs and Kotodama), renders with Puppeteer and ffmpeg, and has a per-beat
`lipSync` option backed by a cloud provider (Replicate). AvatarScript would add a local,
deterministic, avatar-based option next to it.

| MulmoCast | AvatarScript |
|---|---|
| Speaker (`speechParams.speakers`) | Avatar package, referenced from the speaker |
| Beat `text` | Plain text of one script section |
| Beat-level emotion / direction (new) | `.avs` markup for that beat, written by the LLM |
| Per-beat TTS audio | Audio input to the compiler (MulmoCast keeps owning TTS) |
| Beat image / movie | Rendered avatar clip for that beat |

What this means for the design:

- **The compiler accepts existing audio.** Besides calling a TTS adapter, `compile` takes
  `{ audio, timing? }` for a segment. Inside MulmoCast, the TTS it already produced is reused
  and AvatarScript adds only the face.
- **Forced alignment is needed before integration.** MulmoCast's default TTS (OpenAI) returns
  no timing. v1 still starts with ElevenLabs, but the aligner (milestone 6) comes before
  the integration milestone (7).
- **Node only at runtime.** MulmoCast is a Node package, so G2P and alignment should run from
  Node (e.g. kuromoji.js, an espeak-ng WebAssembly build, an ONNX aligner) rather than
  requiring Python.
- **Per-beat clips.** `render` can output one clip per beat (optionally with alpha) so
  MulmoCast composites them with its own transitions, captions and BGM.
- **Library API**, usable as a GraphAI agent:
  `compile({ avatar, script, audio?, timing? }) → score` and `render({ avatar, score }) → clip`.

## Proposed repository layout

```
avatarscript/
  PLAN.md
  spec/
    avatar.md            # avatar package spec + JSON Schema
    script.md            # .avs grammar
    score.md             # score spec + JSON Schema
  packages/
    core/                # parser, compiler, viseme tables, G2P adapters
    tts-elevenlabs/
    runtime-mesh/        # score player + renderer for the mesh engine
    cli/
  examples/
    hello-ja.txt, hello-en.txt, hello.avs, score.json
```

How the mesh engine is consumed is an open question (see below). v1 can use a local path
dependency on a sibling checkout (`../mesh-avatar-studio`).

## Milestones

Each milestone ends with generated output inspected visually, not only tests.

1. **Specs.** `avatar.md`, `script.md`, `score.md` with JSON Schemas; `avatar.json` for the Miko
   sample.
   *Done when:* the Miko manifest validates and the schemas reject sample errors.
2. **Render from a hand-written score.** Engine changes 1–5, score player, `render` command.
   *Done when:* a hand-written score renders to an mp4 with emotions, motions and vowel mouths
   in the right places; two renders with the same seed are byte-identical in frames; the 0 px
   regression and existing mesh-avatar-studio tests pass.
3. **ElevenLabs + compile.** Adapter, segmenting, stitching, character timing → visemes, G2P for
   Japanese and English, tag-offset check.
   *Done when:* a Japanese and an English `.avs` each produce a video whose mouth matches the
   speech on frame-by-frame review.
4. **Script language.** Parser, validation, unchanged-text check, anchor resolution, caching.
   *Done when:* edits to motions re-render without TTS calls; invalid scripts give clear errors.
5. **LLM step + `make`.** Prompt from capabilities, validation and retry.
   *Done when:* `make` produces a video from plain text in Japanese and English.

6. **Forced alignment + OpenAI and Gemini.** A local multilingual CTC aligner (e.g. Meta's MMS
   model, run from Node via ONNX; `MMS_FA` / `ctc-forced-aligner` in Python as reference). It
   also checks that the audio says the text, which catches LLM-based TTS dropping or changing
   words; mismatched segments are synthesized again. Then the **OpenAI** (`gpt-4o-mini-tts`,
   style via `instructions`) and **Gemini TTS** (style via prompt) adapters.
   *Done when:* aligner timing on ElevenLabs audio is measured against ElevenLabs' own timing
   and the error is acceptable on frame-by-frame review.
7. **MulmoCast integration.** Avatar reference on speakers, beat-level markup, compile from
   MulmoCast's own TTS audio, per-beat clips.
   *Done when:* a MulmoScript with an avatar speaker produces a video in MulmoCast using its
   default TTS provider.

Milestones 1 and 2 need no external service.

## Later

- Other providers with timing: Azure (viseme events), Amazon Polly (speech marks), VOICEVOX
  (mora timings, local, Japanese).
- Audio input (recordings) via ASR word timestamps + alignment.
- Tier 2 mouth drawings through mesh-avatar-studio's drawn-variants flow.
- Other runtimes (Live2D, VRM) implementing the same avatar package and score.
- Multiple avatars in one scene (dialogue).

## Open questions

1. How AvatarScript consumes the mesh engine: path dependency, a published package extracted
   from mesh-avatar-studio, or moving the engine here.
2. ElevenLabs alignment and v3 tags: do tag characters appear in `alignment`? Which of
   `alignment` / `normalized_alignment` maps back to our text?
3. G2P and alignment in Node: MulmoCast integration favors Node-only runtime code, while
   espeak-ng, Japanese readings and CTC alignment are most mature in Python. Python may be used
   for prototyping and as an accuracy reference.
4. Script file extension: `.avs` is also used by AviSynth; alternatives `.avscript`,
   `.avatarscript`.
5. Default pacing rules for the LLM (motion density, emotion granularity) — to tune on real
   output.
6. Name check: trademarks and domains for "AvatarScript" are not yet checked.
7. MulmoScript schema changes: where the avatar reference and per-beat markup live, and whether
   AvatarScript replaces or sits beside MulmoCast's existing `lipSync` option.
