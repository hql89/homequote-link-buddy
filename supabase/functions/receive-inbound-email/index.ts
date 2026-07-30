/**
 * receive-inbound-email
 *
 * Receiving end of the n8n IMAP bridge (see
 * docs/plans/implementation_plan_inbound_email.md and
 * n8n/inbound_email_workflow.json — pattern read from Mivos.ai's
 * receive-email-lead, nothing in that project was modified). n8n polls the
 * outreach mailbox and POSTs each message here as
 * {from, to, subject, text, html}.
 *
 * Every message is logged to inbound_emails before any interpretation —
 * message_id is unique, so a re-poll delivering the same message is a
 * dedupe no-op, never a second suppression. An unmatched sender is still
 * logged with business_id null, never silently dropped.
 *
 * Classification is deterministic (_shared/inboundClassifier.ts), not an
 * LLM — see that module's header for why. The only automatic *action* taken
 * here is setting outreach_suppressed_at on an unsubscribe; everything else
 * (applying a replied URL, marking a reply handled) is a human decision made
 * in /admin/replies. Nothing in this function ever sends mail — an
 * auto-responder meeting a vacation auto-responder is a mail loop, and that
 * failure mode is worse than the one this function exists to prevent.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { corsHeaders, json } from "../_shared/directory.ts";
import { extractEmail, extractName, classifyReply } from "../_shared/inboundClassifier.ts";

const JOB_NAME = "receive-inbound-email";

interface InboundPayload {
  from?: string;
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
  message_id?: string;
}

/** Strips tags for the rare case a sender's client sends HTML-only with no text part. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Escapes ilike's wildcard characters. Email local-parts can legally contain
 * `%`, and ilike treats it as a wildcard — an unescaped match could attach an
 * inbound message to (and suppress) the wrong business.
 */
function escapeIlike(value: string): string {
  return value.replace(/[%_\\]/g, (c) => `\\${c}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // Token travels as a path segment (/receive-inbound-email/<token>) or a
    // header — same dual support Mivos's receiver uses, since n8n's HTTP
    // node can supply either depending on how the workflow is authored.
    const url = new URL(req.url);
    const pathToken = url.pathname.split("/").filter(Boolean).pop();
    const headerToken = req.headers.get("x-webhook-token");
    const configuredToken = Deno.env.get("INBOUND_EMAIL_WEBHOOK_TOKEN");

    const suppliedToken = pathToken === "receive-inbound-email" ? headerToken : pathToken;
    if (!configuredToken || suppliedToken !== configuredToken) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }

    const payload = (await req.json().catch(() => null)) as InboundPayload | null;
    if (!payload || !payload.from) {
      return json({ success: false, error: "Missing sender." }, 400);
    }

    const bodyText = payload.text || (payload.html ? stripHtml(payload.html) : "") || "";
    // n8n's IMAP node includes a message-id header on the resolved item;
    // falling back to a hash-free composite key still gives dedupe coverage
    // for payload shapes that omit it, rather than refusing to log at all.
    const messageId =
      payload.message_id ||
      `${extractEmail(payload.from)}|${payload.subject ?? ""}|${bodyText.slice(0, 100)}`;

    const fromEmail = extractEmail(payload.from);
    const fromName = extractName(payload.from);
    const { classification, extractedUrl, isPriority } = classifyReply(bodyText);

    const { data: business } = await supabase
      .from("businesses")
      .select("id")
      .ilike("email", escapeIlike(fromEmail))
      .maybeSingle();

    // Unsubscribe is the one classification that acts automatically.
    // Everything else — applying a URL, or just reading an inquiry — is a
    // human decision made in /admin/replies.
    if (classification === "unsubscribe" && business) {
      await supabase
        .from("businesses")
        .update({ outreach_suppressed_at: new Date().toISOString() })
        .eq("id", business.id);
    }

    // message_id is UNIQUE; ON CONFLICT DO NOTHING makes a re-poll a true
    // no-op rather than a duplicate-key error the caller has to swallow.
    const { error: insertError } = await supabase
      .from("inbound_emails")
      .insert({
        message_id: messageId,
        business_id: business?.id ?? null,
        from_email: fromEmail,
        from_name: fromName,
        subject: payload.subject ?? null,
        body_text: bodyText || null,
        classification,
        extracted_url: extractedUrl,
        is_priority: isPriority,
      })
      .select("id")
      .single();

    if (insertError && insertError.code !== "23505") {
      // 23505 = unique_violation on message_id — an expected dedupe hit, not a failure.
      throw new Error(`Insert failed: ${insertError.message}`);
    }

    return json({ success: true, classification, matched: Boolean(business), duplicate: insertError?.code === "23505" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${JOB_NAME}]`, message);
    return json({ success: false, error: "Could not process that message." }, 500);
  }
});
