/**
 * Turns the scattered state that governs outreach into one ordered, plain-English
 * answer to "can this send, and if not, what do I do next?".
 *
 * That question was asked four separate times in one working session, and each
 * answer required reading four different screens plus the database: the delivery
 * proof lives in Settings → Email, the schedule in Settings → Background Jobs,
 * which businesses are switched on in Email Finder, and the copy and daily limit
 * on Outreach itself. None of them can see the others, so no screen could say
 * whether anything would actually go out. This can.
 *
 * The checks are ordered to match send-outreach-drip's real gate order, so the
 * first blocker listed is genuinely the first one the job would hit.
 */

export type ReadinessLevel = "ok" | "attention" | "blocked";

export interface ReadinessCheck {
  id: string;
  /** What is being checked, as a person would name it. */
  label: string;
  /** The current state, in plain words. Never a bare number without its meaning. */
  detail: string;
  level: ReadinessLevel;
  /** Where to go to change it. Omitted when there is nothing to do. */
  action?: { text: string; href: string };
}

export interface ReadinessInput {
  deliveryVerifiedAt: string | null;
  now: Date;
  activeVerifyVariants: number;
  activePreviewVariants: number;
  /** Switched on, verified email, not suppressed, not yet emailed. */
  eligibleBusinesses: number;
  /** Verified email but still paused — the pool one click could unlock. */
  pausedWithEmail: number;
  needsReview: number;
  /** null when pg_cron could not be read — unknown, which is not the same as off. */
  cronActive: boolean | null;
  dailyLimit: number;
  sentToday: number;
  bccEmail: string | null;
}

export interface ReadinessResult {
  headline: string;
  sublabel: string;
  level: ReadinessLevel;
  checks: ReadinessCheck[];
}

/**
 * Must match DELIVERY_PROOF_MAX_AGE_DAYS in send-outreach-drip.
 *
 * Deliberately duplicated rather than imported: edge functions run under Deno
 * and cannot share a module with the Vite build (the app's tsconfig only
 * includes `src`). If the sending gate ever changes, this has to change with
 * it — a readiness panel that says "fine" while the job refuses to send would
 * be worse than no panel, so the two are pinned together by test.
 */
export const DELIVERY_PROOF_MAX_AGE_DAYS = 14;

/** Warn this far ahead so the proof can be renewed before it lapses. */
const DELIVERY_WARN_WITHIN_DAYS = 3;

const DAY_MS = 86_400_000;

function daysBetween(from: number, to: number): number {
  return Math.floor((to - from) / DAY_MS);
}

export function computeOutreachReadiness(input: ReadinessInput): ReadinessResult {
  const checks: ReadinessCheck[] = [];

  // ── 1. Delivery proof — the job's first gate ─────────────────────────────
  const verifiedMs = input.deliveryVerifiedAt ? Date.parse(input.deliveryVerifiedAt) : NaN;
  if (Number.isNaN(verifiedMs)) {
    checks.push({
      id: "delivery",
      label: "Delivery confirmed",
      detail: "Nobody has confirmed that email actually arrives. Nothing will send until they do.",
      level: "blocked",
      action: { text: "Send a test email", href: "/admin/settings" },
    });
  } else {
    const age = daysBetween(verifiedMs, input.now.getTime());
    const daysLeft = DELIVERY_PROOF_MAX_AGE_DAYS - age;
    if (daysLeft <= 0) {
      checks.push({
        id: "delivery",
        label: "Delivery confirmed",
        detail: `Last confirmed ${age} days ago, which has expired. Sending is paused until it is confirmed again.`,
        level: "blocked",
        action: { text: "Send a test email", href: "/admin/settings" },
      });
    } else if (daysLeft <= DELIVERY_WARN_WITHIN_DAYS) {
      checks.push({
        id: "delivery",
        label: "Delivery confirmed",
        detail: `Expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}. Sending stops on its own when it does.`,
        level: "attention",
        action: { text: "Re-confirm now", href: "/admin/settings" },
      });
    } else {
      checks.push({
        id: "delivery",
        label: "Delivery confirmed",
        detail: `Good for another ${daysLeft} days.`,
        level: "ok",
      });
    }
  }

  // ── 2. Copy — a stage with nothing active is skipped entirely ────────────
  const deadStages = [
    input.activeVerifyVariants === 0 ? "Email 1" : null,
    input.activePreviewVariants === 0 ? "Email 2" : null,
  ].filter(Boolean) as string[];

  if (deadStages.length > 0) {
    checks.push({
      id: "copy",
      label: "Email copy",
      detail: `${deadStages.join(" and ")} ${
        deadStages.length === 1 ? "has" : "have"
      } no active version, so ${deadStages.length === 1 ? "it" : "they"} will not be sent at all.`,
      level: "blocked",
      action: { text: "Switch a version on", href: "/admin/outreach" },
    });
  } else {
    checks.push({
      id: "copy",
      label: "Email copy",
      detail: "Both emails have an active version.",
      level: "ok",
    });
  }

  // ── 3. Who is actually eligible ──────────────────────────────────────────
  if (input.eligibleBusinesses === 0) {
    const hint = input.pausedWithEmail > 0
      ? `${input.pausedWithEmail} ${input.pausedWithEmail === 1 ? "business is" : "businesses are"} ready but still switched off.`
      : input.needsReview > 0
        ? `${input.needsReview} awaiting review could become eligible once confirmed.`
        : "No business has a verified email address yet.";
    checks.push({
      id: "recipients",
      label: "Businesses to contact",
      detail: `Nobody is eligible right now. ${hint}`,
      level: "blocked",
      action: { text: "Open Email Finder", href: "/admin/enrichment" },
    });
  } else {
    const extra = input.pausedWithEmail > 0 ? ` ${input.pausedWithEmail} more are switched off.` : "";
    checks.push({
      id: "recipients",
      label: "Businesses to contact",
      detail: `${input.eligibleBusinesses} waiting to be emailed.${extra}`,
      level: "ok",
      action: input.pausedWithEmail > 0
        ? { text: "Switch more on", href: "/admin/enrichment" }
        : undefined,
    });
  }

  // ── 4. Schedule. Off is not a fault — "Run now" still works ──────────────
  if (input.cronActive === null) {
    checks.push({
      id: "schedule",
      label: "Automatic sending",
      detail: "The schedule could not be read, so whether this runs on its own is unknown.",
      level: "attention",
      action: { text: "Check background jobs", href: "/admin/settings" },
    });
  } else if (input.cronActive) {
    checks.push({
      id: "schedule",
      label: "Automatic sending",
      detail: "On — runs by itself once a day at 3:00 PM UTC.",
      level: "ok",
    });
  } else {
    checks.push({
      id: "schedule",
      label: "Automatic sending",
      detail: "Off. Emails only go out when you press Run now.",
      level: "attention",
      action: { text: "Turn on daily sending", href: "/admin/settings" },
    });
  }

  // ── 5. Today's allowance ─────────────────────────────────────────────────
  const remaining = Math.max(0, input.dailyLimit - input.sentToday);
  checks.push({
    id: "allowance",
    label: "Today's limit",
    detail: remaining === 0
      ? `All ${input.dailyLimit} of today's emails have been sent. More can go out tomorrow.`
      : `${remaining} of ${input.dailyLimit} still available today.`,
    level: remaining === 0 ? "attention" : "ok",
  });

  // ── 6. Testing copy — easy to leave on by accident ───────────────────────
  if (input.bccEmail) {
    checks.push({
      id: "bcc",
      label: "Testing copy",
      detail: `Every outreach email is also being sent to ${input.bccEmail}. Turn this off before a full run.`,
      level: "attention",
      action: { text: "Turn off copies", href: "/admin/outreach" },
    });
  }

  // ── Headline ─────────────────────────────────────────────────────────────
  const blockers = checks.filter((c) => c.level === "blocked");

  if (blockers.length > 0) {
    return {
      level: "blocked",
      headline: "Outreach is not sending",
      sublabel: blockers.length === 1
        ? `One thing is in the way: ${blockers[0].label.toLowerCase()}.`
        : `${blockers.length} things are in the way, listed below in the order they matter.`,
      checks,
    };
  }

  if (input.cronActive === true) {
    return {
      level: "ok",
      headline: "Outreach is live",
      sublabel: `Up to ${input.dailyLimit} a day, ${remaining} still available today.`,
      checks,
    };
  }

  return {
    level: "attention",
    headline: "Ready, but only when you press Run now",
    sublabel: "Nothing is blocking a send — automatic daily sending is just switched off.",
    checks,
  };
}
