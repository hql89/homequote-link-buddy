/**
 * unsubscribe
 *
 * Public, unauthenticated endpoint (verify_jwt = false, see config.toml) that
 * is the target of both the {{unsubscribe_url}} link in outreach email copy
 * and the List-Unsubscribe / List-Unsubscribe-Post headers mailer.ts adds to
 * every outreach send (see send-outreach-drip/index.ts).
 *
 * Authorised by possession of `claim_token` alone — the same credential
 * claim-listing already treats as sufficient to view/claim a listing, so
 * reusing it here (rather than minting a second per-business secret) keeps
 * one token per business rather than two to manage.
 *
 *   • GET  — a human clicking the link in the email body. Renders a small,
 *            self-contained confirmation page (no redirect, no JS, no PII
 *            beyond the business name).
 *   • POST — RFC 8058 one-click: mail providers (Gmail, Yahoo, Outlook) POST
 *            here directly, with no page render and typically no meaningful
 *            body, when a recipient taps their own "Unsubscribe" button.
 *            Must succeed on the URL + token alone.
 *
 * Idempotent: only sets outreach_suppressed_at when it is still null, so a
 * second click (or a provider retry) never overwrites the original opt-out
 * time.
 */
import { serviceRoleKey as readServiceRoleKey } from "../_shared/supabaseKeys.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { corsHeaders, logRun } from "../_shared/directory.ts";

const JOB_NAME = "unsubscribe";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function htmlPage(title: string, message: string): Response {
  const body =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${title}</title></head>` +
    `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1a1a1a;line-height:1.5;">` +
    `<h1 style="font-size:1.25rem;">${title}</h1><p>${message}</p></body></html>`;
  return new Response(body, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    readServiceRoleKey(),
  );

  const url = new URL(req.url);
  const token = (url.searchParams.get("token") ?? "").trim();
  const isOneClick = req.method === "POST";

  // Invalid/missing token: never a 4xx to the automated one-click path, since
  // RFC 8058 clients don't interpret the body and some retry on non-2xx —
  // this only ever needs to be a no-op, not an error.
  if (!UUID_RE.test(token)) {
    await logRun(supabase, JOB_NAME, "failure", Date.now() - startedAt, "Invalid or missing token", {
      method: req.method,
    });
    return isOneClick
      ? new Response(null, { status: 200, headers: corsHeaders })
      : htmlPage("Link no longer valid", "This unsubscribe link is invalid or has expired.");
  }

  const { data: business, error } = await supabase
    .from("businesses")
    .select("id, business_name, outreach_suppressed_at")
    .eq("claim_token", token)
    .maybeSingle();

  if (error) {
    console.error(`[${JOB_NAME}]`, error.message);
    await logRun(supabase, JOB_NAME, "failure", Date.now() - startedAt, error.message, { method: req.method });
    return isOneClick
      ? new Response(null, { status: 200, headers: corsHeaders })
      : htmlPage("Something went wrong", "We couldn't process this request. Please reply STOP to the email instead.");
  }

  if (!business) {
    await logRun(supabase, JOB_NAME, "failure", Date.now() - startedAt, "No business for token", {
      method: req.method,
    });
    return isOneClick
      ? new Response(null, { status: 200, headers: corsHeaders })
      : htmlPage("Link no longer valid", "This unsubscribe link is invalid or has expired.");
  }

  // Only write if not already suppressed — preserves the original opt-out
  // timestamp against repeat clicks or a provider's automatic retry.
  if (!business.outreach_suppressed_at) {
    const { error: updateError } = await supabase
      .from("businesses")
      .update({ outreach_suppressed_at: new Date().toISOString() })
      .eq("id", business.id)
      .is("outreach_suppressed_at", null);

    if (updateError) {
      console.error(`[${JOB_NAME}] suppression write failed:`, updateError.message);
      await logRun(supabase, JOB_NAME, "failure", Date.now() - startedAt, updateError.message, {
        business_id: business.id,
        method: req.method,
      });
      return isOneClick
        ? new Response(null, { status: 500, headers: corsHeaders })
        : htmlPage(
          "Something went wrong",
          "We couldn't record your unsubscribe request. Please reply STOP to the email instead.",
        );
    }
  }

  await logRun(supabase, JOB_NAME, "success", Date.now() - startedAt, null, {
    business_id: business.id,
    method: req.method,
    already_suppressed: Boolean(business.outreach_suppressed_at),
  });

  return isOneClick
    ? new Response(null, { status: 200, headers: corsHeaders })
    : htmlPage(
      "You're unsubscribed",
      `You won't receive any more emails about the ${business.business_name} listing.`,
    );
});
