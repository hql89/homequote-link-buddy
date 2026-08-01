/**
 * Outreach mailer: SMTP primary → Resend fallback.
 *
 * SMTP credentials are read from the existing `admin_settings.smtp_config` row
 * (the same source `notify-admin-email` uses) so there is a single place to
 * configure email for the whole project. Resend is only used when SMTP fails,
 * and is configured via the RESEND_API_KEY / RESEND_SENDER_EMAIL secrets.
 */
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { logEmailSend } from "./emailLog.ts";

const SMTP_TIMEOUT_MS = 10_000;
const IMAP_PORTS = [993, 995];

export interface SmtpConfig {
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpPassword: string;
  fromEmail: string;
  fromName: string;
  adminNotificationEmail: string;
  enabled: boolean;
}

export interface SendResult {
  success: boolean;
  method: "smtp" | "resend" | "none";
  error?: string;
  smtpError?: string;
}

export interface OutreachEmail {
  to: string;
  subject: string;
  /** Plain-text body. Email 1 is intentionally text-only for deliverability. */
  text: string;
  /** Optional HTML body. When omitted the message is sent as plain text. */
  html?: string;
}

export async function loadSmtpConfig(
  supabase: SupabaseClient,
): Promise<{ config: SmtpConfig | null; error: string | null }> {
  const { data, error } = await supabase
    .from("admin_settings")
    .select("setting_value")
    .eq("setting_key", "smtp_config")
    .maybeSingle();

  if (error) return { config: null, error: `Failed to read SMTP settings: ${error.message}` };
  if (!data) return { config: null, error: "SMTP not configured. Go to Admin → Settings to set up email." };

  return { config: data.setting_value as SmtpConfig, error: null };
}

async function sendViaSmtp(config: SmtpConfig, email: OutreachEmail): Promise<void> {
  if (!config.enabled) throw new Error("SMTP is disabled in admin settings.");
  if (IMAP_PORTS.includes(config.smtpPort)) {
    throw new Error(
      `Port ${config.smtpPort} is an IMAP/POP3 port. Use 465 (SSL) or 587 (STARTTLS) for sending.`,
    );
  }

  const client = new SMTPClient({
    connection: {
      hostname: config.smtpHost,
      port: config.smtpPort,
      tls: config.smtpPort === 465,
      auth: { username: config.smtpUsername, password: config.smtpPassword },
    },
  });

  const sendPromise = (async () => {
    await client.send({
      from: `${config.fromName} <${config.fromEmail}>`,
      to: email.to,
      subject: email.subject,
      content: email.text,
      ...(email.html ? { html: email.html } : {}),
    });
    await client.close();
  })();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`SMTP connection timed out after ${SMTP_TIMEOUT_MS / 1000}s.`)),
      SMTP_TIMEOUT_MS,
    )
  );

  await Promise.race([sendPromise, timeoutPromise]);
}

async function sendViaResend(email: OutreachEmail, fallbackFrom: string): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) throw new Error("RESEND_API_KEY is not set — no fallback available.");

  const from = Deno.env.get("RESEND_SENDER_EMAIL") || fallbackFrom;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email.to],
      subject: email.subject,
      text: email.text,
      ...(email.html ? { html: email.html } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend responded ${res.status}: ${body.slice(0, 300)}`);
  }
}

/**
 * Identifies an outbound send for the audit trail.
 *
 * Deliberately a REQUIRED argument to `sendOutreachEmail` rather than an
 * optional one: a new call site that forgets to supply it fails to compile,
 * which is the only reliable guarantee that every email this project sends
 * ends up in `email_send_log`.
 */
export interface EmailAuditContext {
  supabase: SupabaseClient;
  /** The calling function, e.g. "send-outreach-drip". */
  jobName: string;
  /** Semantic kind, e.g. "outreach_verify", "quote_request". */
  emailType: string;
  recipientKind?: string;
  /** Soft references — safe to pass ids of rows that may later be deleted. */
  relatedBusinessId?: string | null;
  relatedLeadId?: string | null;
}

/**
 * Attempts SMTP first, then Resend. Never throws — always returns a result so
 * the caller can record per-recipient outcomes without aborting a batch.
 *
 * Every outcome, success or failure, is written to `email_send_log` with the
 * recipient's literal address before this returns.
 */
export async function sendOutreachEmail(
  config: SmtpConfig | null,
  email: OutreachEmail,
  audit: EmailAuditContext,
): Promise<SendResult> {
  const result = await attemptSend(config, email);

  await logEmailSend(audit.supabase, {
    jobName: audit.jobName,
    emailType: audit.emailType,
    recipientEmail: email.to,
    recipientKind: audit.recipientKind,
    subject: email.subject,
    relatedBusinessId: audit.relatedBusinessId,
    relatedLeadId: audit.relatedLeadId,
    status: result.success ? "sent" : "failed",
    method: result.method,
    // On success via Resend, smtpError still explains why the primary failed —
    // worth keeping, since a silently-degraded mailer is a real condition.
    errorMessage: result.success ? (result.smtpError ?? null) : (result.error ?? null),
  });

  return result;
}

/** The actual SMTP → Resend attempt. Split out so logging wraps every path. */
async function attemptSend(
  config: SmtpConfig | null,
  email: OutreachEmail,
): Promise<SendResult> {
  let smtpError: string | undefined;

  if (config) {
    try {
      await sendViaSmtp(config, email);
      return { success: true, method: "smtp" };
    } catch (err) {
      smtpError = err instanceof Error ? err.message : String(err);
      console.error(`[mailer] SMTP failed for ${email.to}, trying Resend:`, smtpError);
    }
  } else {
    smtpError = "No SMTP config available.";
  }

  try {
    const fallbackFrom = config
      ? `${config.fromName} <${config.fromEmail}>`
      : "Local Pros Directory <onboarding@resend.dev>";
    await sendViaResend(email, fallbackFrom);
    return { success: true, method: "resend", smtpError };
  } catch (err) {
    const resendError = err instanceof Error ? err.message : String(err);
    console.error(`[mailer] Resend fallback also failed for ${email.to}:`, resendError);
    return {
      success: false,
      method: "none",
      smtpError,
      error: `SMTP: ${smtpError ?? "n/a"} | Resend: ${resendError}`,
    };
  }
}
