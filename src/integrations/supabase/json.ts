/**
 * Narrowing for the generated `Json` type.
 *
 * `types.ts` types every jsonb column and RPC output as `Json`, which is any
 * JSON value — a string or a number just as much as an object. Most of this
 * codebase actually wants `Record<string, unknown>`, because the value was
 * written as an object by an edge function or produced by `to_jsonb(row)`.
 *
 * That claim is true but not provable to the compiler, and the usual answer
 * has been `as Record<string, unknown>`, which is a lie on the day the value
 * is not an object. This checks instead of asserting, so a scalar becomes
 * `null` rather than an object whose every property reads `undefined`.
 */
import type { Json } from "./types";

/** The value if it is a JSON object, `null` for anything else (including an array). */
export function jsonObject(value: Json | null | undefined): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value;
}
