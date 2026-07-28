/**
 * Classifies why `admin_list_cron_jobs` / `admin_toggle_cron_job` failed.
 *
 * Both RPCs are SECURITY DEFINER with `SET search_path = public, cron` and read
 * `cron.job` without guarding for the extension. On a database where pg_cron
 * isn't installed the body fails at runtime and PostgREST reports SQLSTATE
 * 42P01 (undefined_table). The admin check above it raises a plpgsql exception
 * instead, which arrives as P0001.
 *
 * Telling those apart matters: "the extension isn't installed" and "you aren't
 * an admin" need different words on screen, and neither should be rendered as a
 * job that is simply switched off.
 */
export type CronFailure =
  /** pg_cron is absent — there is no schedule to read or write. */
  | "unavailable"
  /** The caller isn't an admin. */
  | "forbidden"
  /** Anything else; show the raw message rather than guess. */
  | "unknown";

/** PostgREST error payload. Every field is optional — assume nothing. */
interface MaybePostgrestError {
  code?: unknown;
  message?: unknown;
}

const UNDEFINED_TABLE = "42P01";
const RAISED_EXCEPTION = "P0001";

export function classifyCronError(error: unknown): CronFailure {
  if (!error || typeof error !== "object") return "unknown";

  const { code, message } = error as MaybePostgrestError;
  const text = typeof message === "string" ? message : "";

  if (code === UNDEFINED_TABLE) return "unavailable";
  if (code === RAISED_EXCEPTION && /forbidden/i.test(text)) return "forbidden";

  // No usable code — fall back to the message. Deliberately narrow: it must
  // name the cron table specifically, so an unrelated missing relation doesn't
  // get reported to an admin as "scheduling is unavailable".
  if (/cron\.job/i.test(text) && /does not exist/i.test(text)) return "unavailable";
  if (!code && /^forbidden$/i.test(text.trim())) return "forbidden";

  return "unknown";
}

/** The message shown when the classifier can't do better than the raw error. */
export function cronErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const { message } = error as MaybePostgrestError;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "The scheduler could not be reached.";
}
