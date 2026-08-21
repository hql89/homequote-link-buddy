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
 *   • GET  — a human clicking the link in the email body. Renders a small
 *            plain-text confirmation (no PII beyond the business name).
 *            NOT html: Supabase Edge Functions silently rewrite a `GET`
 *            response's Content-Type to text/plain regardless of what the
 *            function sets ("HTML content is not supported", per Supabase's
 *            own Edge Functions docs) — confirmed against this deployment on
 *            2026-08-20, where an `htmlPage()` version of this function came
 *            back labelled text/plain with the markup un-rendered. Since the
 *            platform enforces plain text either way, this authors it as
 *            plain text on purpose rather than shipping mangled tag soup to
 *            a real business owner who just clicked "unsubscribe".
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

function textPage(message: string): Response {
  return new Response(message, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
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
      : textPage("This unsubscribe link is invalid or has expired.");
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
      : textPage("We couldn't process this request. Please reply STOP to the email instead.");
  }

  if (!business) {
    await logRun(supabase, JOB_NAME, "failure", Date.now() - startedAt, "No business for token", {
      method: req.method,
    });
    return isOneClick
      ? new Response(null, { status: 200, headers: corsHeaders })
      : textPage("This unsubscribe link is invalid or has expired.");
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
        : textPage("We couldn't record your unsubscribe request. Please reply STOP to the email instead.");
    }
  }

  await logRun(supabase, JOB_NAME, "success", Date.now() - startedAt, null, {
    business_id: business.id,
    method: req.method,
    already_suppressed: Boolean(business.outreach_suppressed_at),
  });

  return isOneClick
    ? new Response(null, { status: 200, headers: corsHeaders })
    : textPage(`You're unsubscribed. You won't receive any more emails about the ${business.business_name} listing.`);
});
