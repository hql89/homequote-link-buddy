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
    default:
      return summariseGeneric(metadata);
  }
}
