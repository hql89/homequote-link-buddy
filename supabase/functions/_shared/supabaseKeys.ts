/**
 * Supabase API keys, read from the new publishable/secret key system.
 *
 * Supabase is retiring the legacy `anon` / `service_role` keys by the end of
 * 2026 and has already removed the ability to rotate them — so the legacy
 * `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` variables are on their
 * way out and cannot be changed if one ever leaks. The replacements can be
 * rotated individually and immediately.
 *
 * The shape differs, which is the only reason this module exists:
 *
 *   legacy:  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")   -> a plain string
 *   new:     Deno.env.get("SUPABASE_SECRET_KEYS")        -> a JSON object,
 *                                                           keyed by key name
 *
 * Doing that JSON.parse in each of 28 functions would mean 28 places to fix if
 * the key name ever changes, and 28 different ways to fail. It happens here.
 *
 * DELIBERATELY NO FALLBACK TO THE LEGACY KEYS. Falling back would keep a
 * half-migrated function silently working, which is precisely the state this
 * migration needs to be able to detect: everything would look healthy right up
 * until the legacy keys are switched off, and then fail all at once with no
 * signal about which functions were still relying on them. A loud failure here,
 * before cutover, is far cheaper than a silent one after. Rollback is a revert
 * and redeploy — the legacy variables remain available until they are
 * explicitly disabled in the dashboard.
 *
 * See docs/plans/implementation_plan_api_key_migration_2026-08-01.md
 */

/** The key name Supabase assigns by default. Both key sets use it. */
const DEFAULT_KEY_NAME = "default";

const SECRET_KEYS_VAR = "SUPABASE_SECRET_KEYS";
const PUBLISHABLE_KEYS_VAR = "SUPABASE_PUBLISHABLE_KEYS";

/**
 * Thrown when a key cannot be resolved. Named so a caller — or a log — can tell
 * a configuration problem apart from a genuine auth failure against Supabase.
 */
export class SupabaseKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseKeyError";
  }
}

/**
 * Reads one key out of a JSON-object env var.
 *
 * Every failure names the variable it was reading, because the symptom at the
 * call site ("createClient got undefined") says nothing about which of the two
 * key sets is misconfigured.
 */
function readKey(varName: string, keyName: string): string {
  const raw = Deno.env.get(varName);

  if (!raw) {
    throw new SupabaseKeyError(
      `${varName} is not set. This project has migrated to Supabase's ` +
        `publishable/secret API keys; the legacy key variables are no longer used.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // The value itself is never included in the message — it is a credential.
    throw new SupabaseKeyError(`${varName} is not valid JSON (expected an object of key name -> key).`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new SupabaseKeyError(`${varName} parsed to ${Array.isArray(parsed) ? "an array" : typeof parsed}, expected an object.`);
  }

  const value = (parsed as Record<string, unknown>)[keyName];

  if (typeof value !== "string" || value.trim() === "") {
    const available = Object.keys(parsed as Record<string, unknown>);
    throw new SupabaseKeyError(
      `${varName} has no usable key named "${keyName}". ` +
        `Available names: ${available.length ? available.join(", ") : "(none)"}.`,
    );
  }

  return value;
}

/**
 * The privileged key. Bypasses RLS — server-side only, never sent to a browser.
 *
 * Replaces `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`.
 */
export function serviceRoleKey(keyName: string = DEFAULT_KEY_NAME): string {
  return readKey(SECRET_KEYS_VAR, keyName);
}

/**
 * The low-privilege key, safe to expose. Carries the same permissions the
 * legacy `anon` key did, so RLS behaviour is unchanged.
 *
 * Replaces `Deno.env.get("SUPABASE_ANON_KEY")`.
 */
export function publishableKey(keyName: string = DEFAULT_KEY_NAME): string {
  return readKey(PUBLISHABLE_KEYS_VAR, keyName);
}
