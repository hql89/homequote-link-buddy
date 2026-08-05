/**
 * confirm-canary
 *
 * Receiving end of the delivery canary. An n8n workflow with a Gmail API
 * trigger — not IMAP, and not this project's own dead inbound bridge —
 * watches the probe recipient's inbox for subjects matching
 * "HomeQuoteLink Delivery Probe #<token>" and POSTs the token here.
 *
 * No auth beyond the token itself: possession of the token IS proof the
 * probe email was actually received and read, which is exactly what this
 * endpoint exists to confirm. A shared secret on top would prove nothing
 * about delivery that the token doesn't already prove, and receive-inbound-
 * email's own webhook-token pattern isn't a fit here — that token protects
 * against forged inbound content being acted on; this one only ever marks a
 * single row it can prove it received. verify_jwt=false (see config.toml).
 *
 * Always returns 200 with a generic body regardless of whether the token
 * matched, an already-confirmed probe, or garbage — deliberately vague, same
 * reasoning as submit-directory-lead's blocked-sender handling: this is a
 * public endpoint, and there is nothing to gain by teaching a prober whether
 * a given token existed.
 */
import { serviceRoleKey as readServiceRoleKey } from "../_shared/supabaseKeys.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { corsHeaders, json } from "../_shared/directory.ts";
import { extractTokenFromSubject } from "../_shared/canary.ts";

const JOB_NAME = "confirm-canary";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ConfirmPayload {
  /** The bare token, if the n8n workflow already extracted it. */
  token?: string;
  /** Or the raw subject line, extracted here — whichever is easier on the n8n side. */
  subject?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false }, 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, readServiceRoleKey());

  try {
    const payload = (await req.json().catch(() => null)) as ConfirmPayload | null;

    const rawToken = (payload?.token ?? "").trim();
    const token = UUID_RE.test(rawToken)
      ? rawToken.toLowerCase()
      : extractTokenFromSubject(payload?.subject ?? "");

    if (!token) {
      // Not an error response: a malformed or unrelated POST teaches an
      // outside caller nothing more than "this token didn't work" either way.
      return json({ success: true, confirmed: false });
    }

    const now = new Date().toISOString();

    // Conditioned on confirmed_at IS NULL so a re-delivered n8n execution
    // (retries happen) can't overwrite an already-recorded confirmation time
    // with a later one.
    // send_status = 'sent' guards against confirming a probe whose send is
    // recorded as having failed — that email was never delivered, so no
    // legitimate caller could ever have read a token from it.
    const { data, error } = await supabase
      .from("email_canary_probes")
      .update({ confirmed_at: now })
      .eq("id", token)
      .eq("send_status", "sent")
      .is("confirmed_at", null)
      .select("id, sent_at")
      .maybeSingle();

    if (error) {
      console.error(`[${JOB_NAME}] update failed for token ${token}:`, error.message);
      return json({ success: true, confirmed: false });
    }

    if (!data) {
      // Either the token never existed, or it was already confirmed —
      // deliberately not distinguished in the response (see header).
      return json({ success: true, confirmed: false });
    }

    const roundTripSeconds = Math.round(
      (new Date(now).getTime() - new Date(data.sent_at).getTime()) / 1000,
    );

    return json({ success: true, confirmed: true, round_trip_seconds: roundTripSeconds });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${JOB_NAME}]`, message);
    // Still 200: this is a public endpoint and an internal error here should
    // not be distinguishable from "token not found" by an outside caller.
    return json({ success: true, confirmed: false });
  }
});
