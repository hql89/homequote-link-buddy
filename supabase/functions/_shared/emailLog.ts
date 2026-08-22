/**
 * Outbound email audit trail.
 *
 * Every email this project sends — successful or not — gets a row in
 * `email_send_log` carrying the recipient's literal address. This exists
 * because on 2026-07-25 four real emails went out, were logged only by
 * business_id/lead_id, and those rows were later deleted: the addresses became
 * unrecoverable. Storing the address itself is what makes that impossible.
 *
 * See docs/plans/implementation_plan_archive_and_audit_2026-08-01.md
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

/** Long free-text fields are capped so one pathological error can't bloat the table. */
const MAX_SUBJECT = 500;
const MAX_ERROR = 1000;
/** An email body is bigger than a subject or error line by nature — the cap
 *  bounds it rather than omitting it, matching the other two long fields. */
const MAX_BODY = 20_000;

export interface EmailLogEntry {
  /** The function that sent it, e.g. "send-outreach-drip". */
  jobName: string;
  /** Semantic kind, e.g. "outreach_verify", "quote_request", "test". */
  emailType: string;
  /** The literal recipient address. Never a lookup key. */
  recipientEmail: string;
  /** "business" | "lead" | "admin" | "buyer" — free-form on purpose. */
  recipientKind?: string;
  subject?: string;
  /**
   * The rendered body actually handed to the send call — plain text or HTML,
   * whichever the email was sent as. Not present on rows logged before this
   * field existed; the admin UI reconstructs those, and only those.
   */
  body?: string | null;
  /** Soft references. Safe to pass ids of rows that may later be deleted. */
  relatedBusinessId?: string | null;
  relatedLeadId?: string | null;
  status: "sent" | "failed";
  method?: string;
  errorMessage?: string | null;
}

function clamp(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Writes one audit row. Never throws.
 *
 * A failure to log must never abort a send or break a batch mid-flight, so
 * errors are swallowed after being surfaced to the function logs. That is a
 * deliberate trade: a missing audit row is bad, a half-sent outreach batch is
 * worse, and the console output still records that it happened.
 */
export async function logEmailSend(
  supabase: SupabaseClient,
  entry: EmailLogEntry,
): Promise<void> {
  try {
    // An empty recipient means the caller has a bug — record it rather than
    // silently dropping the row, since "we sent something to nobody" is itself
    // worth being able to see.
    const recipient = entry.recipientEmail?.trim() || "(unknown)";

    const { error } = await supabase.from("email_send_log").insert({
      job_name: entry.jobName,
      email_type: entry.emailType,
      recipient_email: recipient,
      recipient_kind: entry.recipientKind ?? null,
      subject: clamp(entry.subject, MAX_SUBJECT),
      body: clamp(entry.body, MAX_BODY),
      related_business_id: entry.relatedBusinessId ?? null,
      related_lead_id: entry.relatedLeadId ?? null,
      status: entry.status,
      method: entry.method ?? null,
      error_message: clamp(entry.errorMessage, MAX_ERROR),
    });

    if (error) {
      console.error(
        `[emailLog] FAILED to record ${entry.status} email to ${recipient} from ${entry.jobName}:`,
        error.message,
      );
    }
  } catch (err) {
    console.error(
      `[emailLog] FAILED to record ${entry.status} email from ${entry.jobName}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}
