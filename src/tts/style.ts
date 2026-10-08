// Speaking-style instructions for providers that take them in words (OpenAI, Gemini): a character
// instruction that stays the same for an avatar, combined with a style for the current emotion.
import { z } from "zod";
import { EMOTIONS, type Emotion } from "../script.ts";

/** The `options` fields every instruction-taking provider accepts; each adds its own. */
export const StyleOptionsShape = {
  /** who is speaking and how, for every line: "You are an energetic 7-year-old boy…" */
  instructions: z.string().min(1).optional(),
  /** emotion → spoken-style instruction, replacing the default for that emotion */
  emotionInstructions: z.partialRecord(z.enum(EMOTIONS), z.string()).optional(),
};
type StyleOptions = z.infer<z.ZodObject<typeof StyleOptionsShape>>;

const DEFAULT_EMOTION_STYLES: Record<Emotion, string> = {
  neutral: "Speak naturally and clearly.",
  happy: "Speak warmly and cheerfully.",
  sad: "Speak softly, with a sad tone.",
  angry: "Speak with an irritated, angry tone.",
  surprised: "Speak with surprise and excitement.",
  relaxed: "Speak in a calm, relaxed way.",
};

/** The character instruction, if any, followed by the style for `emotion`. */
export function styleInstruction(options: StyleOptions, emotion: Emotion): string {
  const style = options.emotionInstructions?.[emotion] ?? DEFAULT_EMOTION_STYLES[emotion];
  return options.instructions ? `${options.instructions}\n${style}` : style;
}
