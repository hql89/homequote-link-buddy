/**
 * Archive instead of delete.
 *
 * Nothing in the admin UI destroys a record any more. Removing something marks
 * it archived — it disappears from the site and from admin lists, but the row
 * survives, and every archive is recorded with a full snapshot of the row as
 * it was.
 *
 * Permanent deletion exists (`admin_purge_archived`) but is deliberately not
 * exposed here: it is a size-driven decision, not part of any everyday flow.
 *
 * Background: on 2026-07-25 four businesses were emailed and then hard-deleted,
 * making it impossible to establish which addresses had been contacted. See
 * docs/plans/implementation_plan_archive_and_audit_2026-08-01.md
 */
import { supabase } from "@/integrations/supabase/client";
import { jsonObject } from "@/integrations/supabase/json";
import type { Database } from "@/integrations/supabase/types";

/**
 * Tables the database will accept for archiving. Mirrors
 * `public.archivable_tables()` — anything else is rejected server-side, so
 * this exists to catch typos at compile time rather than to enforce security.
 */
export type ArchivableTable =
  | "businesses"
  | "directory_leads"
  | "leads"
  | "buyers"
  | "buyer_profiles"
  | "homeowner_profiles"
  | "posts"
  | "reviews"
  | "media_assets"
  | "business_photos"
  | "ingest_queue";

/**
 * All four RPCs below are described by the generated `types.ts`, so they are
 * called on the ordinary client and their arguments are genuinely checked.
 * There used to be an `ArchiveRpc` shim here, on the premise that they were
 * absent from it — the same premise `directoryDb` was built on, and false
 * since the schema was regenerated (see 4b1a0a5).
 *
 * What the generator cannot say is said explicitly at each read below: an
 * `RETURNS TABLE` column is always generated as non-null, and `jsonb` is
 * always generated as `Json`.
 */

export interface ArchiveResult {
  error: { message: string } | null;
}

/**
 * Archives one row. Safe to call on an already-archived row — the database
 * reports it and makes no second audit entry.
 *
 * `reason` is worth supplying wherever the UI knows one ("rejected
 * application", "spam review"); it is stored alongside the snapshot.
 */
export async function archiveRow(
  table: ArchivableTable,
  id: string,
  reason?: string,
): Promise<ArchiveResult> {
  // Explicit null, not an omitted key. `p_reason text DEFAULT NULL` accepts it,
  // and the generated argument type — `p_reason?: string` — is the generator
  // rendering a defaulted parameter as optional, which loses that it is also
  // nullable. Sending null keeps the request body identical to what this audited
  // path has always sent, rather than relying on an omitted argument falling
  // through to its default.
  const { error } = await supabase.rpc("admin_archive_row", {
    p_table: table,
    p_id: id,
    p_reason: reason ?? null,
  });
  return { error };
}

/** Exact inverse of {@link archiveRow}: clears the archive columns, nothing else. */
export async function restoreRow(table: ArchivableTable, id: string): Promise<ArchiveResult> {
  const { error } = await supabase.rpc("admin_restore_row", {
    p_table: table,
    p_id: id,
  });
  return { error };
}

/** Human-friendly names for the tables, for the Archive screen. */
export const ARCHIVABLE_TABLE_LABELS: Record<ArchivableTable, string> = {
  businesses: "Directory listings",
  directory_leads: "Quote requests",
  leads: "Leads",
  buyers: "Buyers",
  buyer_profiles: "Provider applications",
  homeowner_profiles: "Homeowner profiles",
  posts: "Blog posts",
  reviews: "Reviews",
  media_assets: "Media",
  business_photos: "Listing photos",
  ingest_queue: "Import queue",
};

export interface ArchivedSummaryRow {
  table_name: ArchivableTable;
  archived_count: number;
}

export interface ArchivedRow {
  id: string;
  /** Best-effort display name resolved server-side; falls back to the id. */
  label: string;
  archived_at: string;
  archived_by: string | null;
  archive_reason: string | null;
  row_data: Record<string, unknown>;
}

type Functions = Database["public"]["Functions"];
type SummaryRpcRow = Functions["admin_archived_summary"]["Returns"][number];
type ListArchivedRpcRow = Functions["admin_list_archived"]["Returns"][number];

/**
 * Narrows one `admin_archived_summary` row.
 *
 * `table_name` generates as `string`, but the function's only source for it is
 * a `FOREACH ... IN ARRAY public.archivable_tables()` loop, so it can only ever
 * hold one of the eleven names {@link ArchivableTable} lists — verified against
 * both the migration (20260801230000) and the deployed function. Naming every
 * column here rather than spreading the row is what makes a renamed column fail
 * the build instead of rendering blank on the Archive screen.
 */
function toSummaryRow(row: SummaryRpcRow): ArchivedSummaryRow {
  return {
    table_name: row.table_name as ArchivableTable,
    // `archived_count` is a bigint `count(*)`. The generator types it as
    // `number`, but bigint is not guaranteed to survive JSON as one, so it is
    // coerced rather than trusted — callers sum and compare it.
    archived_count: Number(row.archived_count),
  };
}

/**
 * Narrows one `admin_list_archived` row.
 *
 * Two things the generator cannot express, both from
 * 20260801250000_admin_list_archived.sql:
 *
 * 1. `archived_by` and `archive_reason` are selected straight from the table's
 *    own nullable columns, but a `RETURNS TABLE` column is always generated
 *    non-null. They are genuinely null on any row archived by the service role
 *    or with no reason given. This project compiles with `strict: false`, so
 *    that mismatch could never have surfaced as an error either way — which is
 *    exactly why it is stated here rather than left to the generated type.
 * 2. `row_data` is `to_jsonb(t)` over a table row, so it is always a JSON
 *    object, never a scalar or null. `Json` cannot say that. It is checked
 *    rather than asserted, and an unexpected shape falls back to `{}` — the
 *    Archive screen calls `Object.entries` on this and would throw on null,
 *    where `{}` renders its "No further detail recorded" state honestly.
 */
function toArchivedRow(row: ListArchivedRpcRow): ArchivedRow {
  return {
    id: row.id,
    label: row.label,
    archived_at: row.archived_at,
    archived_by: row.archived_by ?? null,
    archive_reason: row.archive_reason ?? null,
    row_data: jsonObject(row.row_data) ?? {},
  };
}

/** How many archived rows each table currently holds. */
export async function fetchArchivedSummary(): Promise<{
  data: ArchivedSummaryRow[];
  error: { message: string } | null;
}> {
  const { data, error } = await supabase.rpc("admin_archived_summary");
  return { data: (data ?? []).map(toSummaryRow), error };
}

/** One table's archived rows, newest first. */
export async function fetchArchivedRows(
  table: ArchivableTable,
  limit = 50,
  offset = 0,
): Promise<{ data: ArchivedRow[]; error: { message: string } | null }> {
  const { data, error } = await supabase.rpc("admin_list_archived", {
    p_table: table,
    p_limit: limit,
    p_offset: offset,
  });
  return { data: (data ?? []).map(toArchivedRow), error };
}
