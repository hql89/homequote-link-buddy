/**
 * Turns a `job_run_logs` metadata blob into a plain-English outcome.
 *
 * The status pill alone is misleading: a run that queued 500 businesses and a
 * run that did nothing at all both log "success", because status only reports
 * whether the function threw. The counts that say what actually happened were
 * already being written to `metadata` and then never shown.
 */

export interface RunSummary {
  /** One-line outcome, or null when the run recorded no usable counts. */
  text: string | null;
  /** True when the run completed without changing anything. */
  noChange: boolean;
}

function num(meta: Record<string, unknown>, key: string): number | null {
  const v = meta[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Total across the `rejected` map, whose keys are human-readable reasons. */
function rejectedTotal(meta: Record<string, unknown>): number {
  const r = meta.rejected;
  if (!r || typeof r !== "object" || Array.isArray(r)) return 0;
  return Object.values(r as Record<string, unknown>).reduce<number>(
    (sum, v) => sum + (typeof v === "number" ? v : 0),
    0,
  );
}

/** The single largest rejection reason, for a "mostly X" hint. */
export function topRejectionReason(meta: Record<string, unknown> | null): string | null {
  if (!meta) return null;
  const r = meta.rejected;
  if (!r || typeof r !== "object" || Array.isArray(r)) return null;
  const entries = Object.entries(r as Record<string, unknown>)
    .filter((e): e is [string, number] => typeof e[1] === "number" && e[1] > 0)
    .sort((a, b) => b[1] - a[1]);
  return entries.length > 0 ? entries[0][0] : null;
}

function summariseImport(meta: Record<string, unknown>): RunSummary {
  const inserted = num(meta, "inserted");
  if (inserted === null) return { text: null, noChange: false };

  const duplicates = num(meta, "duplicates") ?? 0;
  const rejected = rejectedTotal(meta);

  const parts = [`${inserted} queued`];
  if (duplicates > 0) parts.push(`${duplicates} already queued`);
  if (rejected > 0) parts.push(`${rejected} rejected`);

  return { text: parts.join(" · "), noChange: inserted === 0 };
}

function summariseProcess(meta: Record<string, unknown>): RunSummary {
  // The worker records `skipped: "disabled"` (a string, not a count) when the
  // engine switch is off — distinct from having nothing to do.
  if (meta.skipped === "disabled") {
    return { text: "engine off — nothing processed", noChange: true };
  }

  const ingested = num(meta, "ingested");
  if (ingested === null) return { text: null, noChange: false };

  const considered = num(meta, "considered") ?? 0;
  if (considered === 0) return { text: "nothing pending", noChange: true };

  const skipped = num(meta, "skipped") ?? 0;
  const failed = num(meta, "failed") ?? 0;

  const parts = [`${ingested} added`];
  if (skipped > 0) parts.push(`${skipped} skipped`);
  if (failed > 0) parts.push(`${failed} failed`);

  return { text: parts.join(" · "), noChange: ingested === 0 };
}

function summariseEnrichment(meta: Record<string, unknown>): RunSummary {
  if (meta.skipped === "disabled") {
    return { text: "enrichment off — nothing processed", noChange: true };
  }

  const considered = num(meta, "considered");
  if (considered === null) return { text: null, noChange: false };
  if (considered === 0) return { text: "nothing pending", noChange: true };

  const verified = num(meta, "verified") ?? 0;
  const needsReview = num(meta, "needs_review") ?? 0;
  const noEmail = num(meta, "no_email") ?? 0;
  const noUrl = num(meta, "no_url") ?? 0;
  const failed = (num(meta, "fetch_failed") ?? 0) + (num(meta, "failed") ?? 0);

  const parts = [`${verified} verified`];
  if (needsReview > 0) parts.push(`${needsReview} needs review`);
  // Two different outcomes, previously folded into one misleading "no email
  // found" label: no_url means Perplexity's search returned no candidate site
  // at all (nothing to fetch), while no_email means a page WAS fetched but
  // had no address on it. Conflated, an admin reading "12 no email found"
  // would assume 12 real sites were checked and came up empty, when most of
  // them were never found in the first place — a different, more useful
  // signal (e.g. a solo contractor with no web presence) to see separately.
  if (noUrl > 0) parts.push(`${noUrl} no website found`);
  if (noEmail > 0) parts.push(`${noEmail} site had no email`);
  if (failed > 0) parts.push(`${failed} failed`);

  return { text: parts.join(" · "), noChange: verified === 0 && needsReview === 0 };
}

/**
 * The outreach drip has more ways to legitimately send nothing than any other
 * job — three gates, plus an exhausted daily budget — and the generic
 * formatter renders all of them as an indistinguishable row of zeroes. Each
 * halt reason says specifically what stopped it and what to do about it.
 */
function summariseOutreach(meta: Record<string, unknown>): RunSummary {
  const halted = typeof meta.halted === "string" ? meta.halted : null;

  if (halted === "delivery_unverified") {
    return { text: "held — delivery not confirmed recently", noChange: true };
  }
  if (halted === "bounce_rate") {
    const bounces = num(meta, "recent_bounces") ?? 0;
    const sends = num(meta, "recent_sends") ?? 0;
    return { text: `stopped — ${bounces} of last ${sends} bounced`, noChange: true };
  }
  if (halted === "daily_limit_reached") {
    const limit = num(meta, "daily_limit") ?? 0;
    const sent = num(meta, "sent_today") ?? 0;
    return { text: `daily limit reached — ${sent} of ${limit} sent today`, noChange: true };
  }

  const email1 = num(meta, "email1_sent");
  const email2 = num(meta, "email2_sent");
  if (email1 === null && email2 === null) return { text: null, noChange: false };

  const sent1 = email1 ?? 0;
  const sent2 = email2 ?? 0;
  const failed = num(meta, "failed") ?? 0;
  const stampFailed = num(meta, "stamp_write_failed") ?? 0;
  const logFailed = num(meta, "send_log_write_failed") ?? 0;

  const parts = [`${sent1 + sent2} sent`];
  if (sent1 + sent2 > 0) parts.push(`${sent1} verification · ${sent2} preview`);
  if (failed > 0) parts.push(`${failed} failed`);
  // Both of these mean an email went out that the system failed to record.
  // Worth naming separately: one risks a duplicate send, the other
  // understates the day's count against the cap.
  if (stampFailed > 0) parts.push(`${stampFailed} may re-send`);
  if (logFailed > 0) parts.push(`${logFailed} uncounted`);

  const limit = num(meta, "daily_limit");
  if (limit !== null) parts.push(`limit ${limit}/day`);

  return { text: parts.join(" · "), noChange: sent1 + sent2 === 0 && failed === 0 };
}

/** Fallback for jobs with no bespoke formatter: show whatever counts exist. */
function summariseGeneric(meta: Record<string, unknown>): RunSummary {
  const counts = Object.entries(meta).filter(
    (e): e is [string, number] => typeof e[1] === "number" && Number.isFinite(e[1]),
  );
  if (counts.length === 0) return { text: null, noChange: false };
  return {
    text: counts.map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join(" · "),
    noChange: counts.every(([, v]) => v === 0),
  };
}

export function summariseRun(
  jobName: string,
  metadata: Record<string, unknown> | null,
): RunSummary {
  if (!metadata || Object.keys(metadata).length === 0) return { text: null, noChange: false };

  switch (jobName) {
    case "import-ingest-queue":
      return summariseImport(metadata);
    case "process-ingest-queue":
      return summariseProcess(metadata);
    case "enrich-business-email":
      return summariseEnrichment(metadata);
    case "send-outreach-drip":
      return summariseOutreach(metadata);
    default:
      return summariseGeneric(metadata);
  }
}
