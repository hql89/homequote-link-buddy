/**
 * Turns one raiseAlarm() record into what a person actually needs to read.
 *
 * _shared/alarm.ts writes { alarm_kind, ...detail } into job_run_logs.metadata
 * and the raw summary into error_message. Neither is fit to show as-is: a
 * kind is a code-facing slug ("email_circuit_breaker"), and error_message is
 * written for a developer reading logs, not an operator scanning a banner.
 * This is the one place that translation happens, so the banner component
 * itself only ever renders plain sentences.
 */

/** Mirrors AlarmKind in supabase/functions/_shared/alarm.ts. Kept in sync by
 *  a test that reads that file's source — see alarmDisplay.test.ts. */
export type AlarmKind =
  | "email_circuit_breaker"
  | "suppression_spike"
  | "action_write_failed"
  | "delivery_canary_failed"
  | "unsubscribe_token_misses";

export interface AlarmRecord {
  id: string;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface DisplayAlarm {
  id: string;
  /** Short, plain-language statement of what happened. Never the raw kind slug. */
  title: string;
  /** The recorded detail, for anyone who wants it — never hidden, just secondary. */
  detail: string | null;
  createdAt: string;
  severity: "critical" | "warning";
}

const TITLES: Record<AlarmKind, string> = {
  email_circuit_breaker: "Outbound email was automatically disabled",
  suppression_spike: "Unsubscribes are arriving far above the normal rate",
  action_write_failed: "An automatic action ran but its write failed silently",
  delivery_canary_failed: "The delivery check couldn't confirm mail is arriving",
  unsubscribe_token_misses: "Unsubscribe links are failing to match a business",
};

const SEVERITY: Record<AlarmKind, DisplayAlarm["severity"]> = {
  email_circuit_breaker: "critical",
  suppression_spike: "warning",
  action_write_failed: "critical",
  delivery_canary_failed: "warning",
  unsubscribe_token_misses: "warning",
};

/**
 * Converts one raw record. Returns a DisplayAlarm even for a kind this build
 * doesn't recognise — falling back to the recorded error_message rather than
 * dropping the alarm. An alarm silently disappearing because the frontend
 * predates a new AlarmKind would recreate exactly the invisibility this
 * banner exists to end.
 */
export function toDisplayAlarm(record: AlarmRecord): DisplayAlarm {
  const kind = typeof record.metadata?.alarm_kind === "string" ? record.metadata.alarm_kind : null;
  const known = kind && kind in TITLES ? (kind as AlarmKind) : null;

  return {
    id: record.id,
    title: known ? TITLES[known] : (record.errorMessage ?? "An unrecognised alarm was recorded"),
    detail: record.errorMessage,
    createdAt: record.createdAt,
    // An unrecognised kind defaults to critical: a false alarm read as urgent
    // costs a glance, but a genuinely serious future kind silently read as a
    // warning would defeat the purpose of the field existing at all.
    severity: known ? SEVERITY[known] : "critical",
  };
}

/** Alarms newer than `seenUpTo`, newest first. `seenUpTo` of null means everything is unseen. */
export function unseenAlarms(alarms: DisplayAlarm[], seenUpTo: string | null): DisplayAlarm[] {
  const cutoff = seenUpTo ? Date.parse(seenUpTo) : -Infinity;
  return alarms
    .filter((a) => Date.parse(a.createdAt) > cutoff)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
