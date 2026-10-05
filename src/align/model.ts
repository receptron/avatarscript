// The acoustic model: wav2vec2 fine-tuned on espeak IPA phonemes (facebook/wav2vec2-lv-60-espeak-cv-ft,
// Apache-2.0), as ONNX (sadda-speech/wav2vec2-espeak-ctc). Downloaded once into the user's cache.
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import type { InferenceSession } from "onnxruntime-node";
import { z } from "zod";
import { resample } from "../audio.ts";
import { errorCode, parseJson } from "../json.ts";
import { CLASSES, tokenClass, type PhoneClass } from "./classes.ts";

const REPO = "https://huggingface.co/sadda-speech/wav2vec2-espeak-ctc/resolve/main";
const FILES = { model: "wav2vec2-espeak-ctc.onnx", vocab: "wav2vec2-espeak-ctc.vocab.json" };
export const MODEL_RATE = 16000;
/** seconds per output frame (320-sample stride at 16 kHz) */
export const FRAME_SECONDS = 0.02;

export const modelDir = () => process.env.AVATARSCRIPT_MODEL_DIR ?? join(homedir(), ".cache", "avatarscript", "models");
const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

async function download(url: string, file: string) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`could not download ${url} (${res.status})`);
  const out = createWriteStream(`${file}.part`);
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!out.write(value)) await once(out, "drain");
  }
  out.end();
  await finished(out);
  await rename(`${file}.part`, file);
}

async function ensureFiles(onDownload?: (what: string) => void) {
  const dir = modelDir();
  await mkdir(dir, { recursive: true });
  for (const [key, name] of Object.entries(FILES)) {
    const file = join(dir, name);
    if (await exists(file)) continue;
    onDownload?.(`${name} (${key === "model" ? "635 MB, once" : "small"})`);
    await download(`${REPO}/${key === "model" ? "model.onnx" : "vocab.json"}`, file);
  }
  return { model: join(dir, FILES.model), vocab: join(dir, FILES.vocab) };
}

/** Log-probabilities per frame for blank and each class (frames × (1 + classes)). */
export interface ClassEmissions {
  frames: number;
  /** [frame * (1 + CLASSES.length) + 0] is blank, + 1 + i is CLASSES[i] */
  logProbs: Float32Array;
}

let loaded: Promise<{ session: InferenceSession; classOf: Int16Array; blank: number }> | null = null;

/**
 * onnxruntime-node is an optional peer dependency (~290 MB): only providers without their own
 * timing (openai, gemini) need it.
 */
async function onnxRuntime(): Promise<typeof import("onnxruntime-node")> {
  try {
    return await import("onnxruntime-node");
  } catch (error) {
    if (errorCode(error) === "ERR_MODULE_NOT_FOUND") {
      throw new Error("timing speech from openai or gemini needs onnxruntime-node: npm install onnxruntime-node", { cause: error });
    }
    throw error;
  }
}

async function load(onDownload?: (what: string) => void) {
  const ort = await onnxRuntime();
  const files = await ensureFiles(onDownload);
  const vocab = parseJson(z.record(z.string(), z.number().int()), await readFile(files.vocab, "utf8"), files.vocab);
  const size = Math.max(...Object.values(vocab)) + 1;
  // -1: not a phoneme; otherwise the class index
  const classOf = new Int16Array(size).fill(-1);
  for (const [token, id] of Object.entries(vocab)) {
    const cls = tokenClass(token);
    if (cls) classOf[id] = CLASSES.indexOf(cls);
  }
  const blank = vocab["<pad>"] ?? 0;
  const session = await ort.InferenceSession.create(files.model, { logSeverityLevel: 3 });
  return { session, classOf, blank };
}

/** Runs the model on mono audio and sums its phonemes into classes. */
export async function classEmissions(samples: Float32Array, sampleRate: number, onDownload?: (what: string) => void): Promise<ClassEmissions> {
  loaded ??= load(onDownload);
  const { session, classOf, blank } = await loaded;
  const ort = await onnxRuntime();
  const x = resample(samples, sampleRate, MODEL_RATE);
  let mean = 0;
  for (const v of x) mean += v;
  mean /= x.length || 1;
  let variance = 0;
  for (const v of x) variance += (v - mean) ** 2;
  const std = Math.sqrt(variance / (x.length || 1)) || 1;
  const input = new ort.Tensor(
    "float32",
    x.map((v) => (v - mean) / std),
    [1, x.length],
  );
  const out = await session.run({ [session.inputNames[0]]: input });
  const logits = out[session.outputNames[0]];
  const [, frames, vocabSize] = logits.dims;
  const data = logits.data;
  if (!(data instanceof Float32Array)) throw new Error("unexpected model output type");
  const width = 1 + CLASSES.length;
  const logProbs = new Float32Array(frames * width);
  const sums = new Float64Array(width);
  for (let t = 0; t < frames; t++) {
    const row = t * vocabSize;
    let max = -Infinity;
    for (let v = 0; v < vocabSize; v++) max = Math.max(max, data[row + v]);
    let total = 0;
    sums.fill(0);
    for (let v = 0; v < vocabSize; v++) {
      const p = Math.exp(data[row + v] - max);
      total += p;
      if (v === blank) sums[0] += p;
      else if (classOf[v] >= 0) sums[1 + classOf[v]] += p;
    }
    for (let c = 0; c < width; c++) logProbs[t * width + c] = Math.log(sums[c] / total + 1e-12);
  }
  return { frames, logProbs };
}

export const classIndex = (cls: PhoneClass) => 1 + CLASSES.indexOf(cls);
