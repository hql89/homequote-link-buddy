/**
 * Extracts the human-readable error an edge function returned.
 *
 * `supabase.functions.invoke` reports any non-2xx response as a generic
 * FunctionsHttpError ("Edge Function returned a non-2xx status code") and
 * leaves `data` null, which would hide the specific messages our functions
 * send (wrong email, call cooldown, demo-call cap, …). The real body is on
 * `error.context`, so read it from there before falling back.
 */
interface MaybeErrorBody {
  error?: unknown;
  success?: unknown;
}

export async function extractEdgeError(
  error: unknown,
  data: unknown,
  fallback: string,
): Promise<string> {
  // Happy path: function returned 200 with { success: false, error }.
  const body = data as MaybeErrorBody | null;
  if (body && typeof body === "object" && typeof body.error === "string" && body.error) {
    return body.error;
  }

  // Non-2xx: the Response is attached as `context`.
  const context = (error as { context?: unknown })?.context;
  if (context instanceof Response) {
    try {
      const parsed = (await context.clone().json()) as MaybeErrorBody;
      if (typeof parsed?.error === "string" && parsed.error) return parsed.error;
    } catch {
      // Body wasn't JSON — fall through.
    }
  }

  if (error instanceof Error && error.message && !/non-2xx/i.test(error.message)) {
    return error.message;
  }

  return fallback;
}
