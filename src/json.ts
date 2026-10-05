// Reading untyped JSON (files, provider responses, cache entries) through a zod schema, so the
// data is checked where it enters instead of asserted to have a type it may not have.
import { z } from "zod";

/** Parses JSON text against a schema; errors name the source and every mismatch. */
export function parseJson<T extends z.ZodType>(schema: T, text: string, where: string): z.output<T> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${where}: invalid JSON (${error instanceof Error ? error.message : "unreadable"})`, { cause: error });
  }
  return check(schema, value, where);
}

/** Checks an already-parsed value against a schema. */
export function check<T extends z.ZodType>(schema: T, value: unknown, where: string): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`${where} is not valid:\n${z.prettifyError(result.error)}`);
  return result.data;
}

const SystemError = z.object({ code: z.string() });

/** The `code` of a Node.js system error (ENOENT, …), if it is one. */
export const errorCode = (error: unknown): string | undefined => SystemError.safeParse(error).data?.code;
