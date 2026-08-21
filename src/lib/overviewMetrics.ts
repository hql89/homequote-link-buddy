/**
 * Range arithmetic and activity merging for the admin Overview.
 *
 * Pure and separately testable for the same reason outreachReadiness.ts is:
 * the numbers on a control-center home screen are only worth showing if the
 * period they cover, and the period they are compared against, are exactly
 * what the label claims. An off-by-one on a comparison window silently turns
 * "up 40%" into fiction, and nothing about the rendered card would look wrong.
 */

export type RangePreset = "today" | "7d" | "30d";

export interface RangeWindow {
  /** Inclusive start of the period being reported. */
  since: Date;
  /** Exclusive end — "now" for every preset; kept explicit so tests can pin it. */
  until: Date;
  /** The equally-long window immediately before `since`, for comparison. */
  prevSince: Date;
  prevUntil: Date;
  /** Human label for the period, e.g. "today" or "the last 7 days". */
  label: string;
}

const DAY_MS = 86_400_000;

/**
 * Builds the reporting window and the equal-length window before it.
 *
 * "today" deliberately means since local midnight, not the last 24 hours: an
 * operator reading "new leads today" means the calendar day they are living
 * in, and a rolling 24h window would silently include yesterday evening.
 * The comparison period for "today" is therefore yesterday's same span.
 */
export function resolveRange(preset: RangePreset, now: Date = new Date()): RangeWindow {
  if (preset === "today") {
    const since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const spanMs = now.getTime() - since.getTime();
    return {
      since,
      until: now,
      prevSince: new Date(since.getTime() - DAY_MS),
      // Same elapsed span yesterday, not all of yesterday — comparing 9am
      // today against a full 24h yesterday would always look like a collapse.
      prevUntil: new Date(since.getTime() - DAY_MS + spanMs),
      label: "today",
    };
  }

  const days = preset === "7d" ? 7 : 30;
  const since = new Date(now.getTime() - days * DAY_MS);
  return {
    since,
    until: now,
    prevSince: new Date(now.getTime() - 2 * days * DAY_MS),
    prevUntil: since,
    label: `the last ${days} days`,
  };
}

/** One thing that happened, from whichever table it came from. */
export interface ActivityEvent {
  id: string;
  at: string;
  /** Plain-language sentence. Never a status code or raw column value. */
  text: string;
  kind: "outreach" | "reply" | "claim" | "lead" | "job";
  /** Where clicking should go, when the event has a screen worth opening. */
  href?: string;
}

/**
 * Merges events from several tables into one newest-first feed.
 *
 * Sorting happens here rather than in SQL because the sources are genuinely
 * different tables with different shapes and no shared view; a UNION in a
 * database function would need maintaining every time a source is added,
 * whereas this only needs the caller to append another array.
 */
export function mergeActivity(sources: ActivityEvent[][], limit = 12): ActivityEvent[] {
  return sources
    .flat()
    .filter((e) => !Number.isNaN(Date.parse(e.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, limit);
}

/**
 * Percentage change, or null when it cannot honestly be expressed.
 *
 * Returns null rather than 0 when the previous period was empty AND the
 * current one is too: "0% change" on 0-vs-0 reads as a measured result, when
 * in fact nothing happened either period and there is no trend to report.
 */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return 100;
  return ((current - previous) / previous) * 100;
}
