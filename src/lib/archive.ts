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
 * The RPCs are absent from the generated `types.ts`, which would otherwise
 * resolve their argument type to `never`. One narrow cast here rather than a
 * scattering of them at call sites — same approach as `directoryDb`.
 */
interface ArchiveRpc {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

const db = supabase as unknown as ArchiveRpc;

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
  const { error } = await db.rpc("admin_archive_row", {
    p_table: table,
    p_id: id,
    p_reason: reason ?? null,
  });
  return { error };
}

/** Exact inverse of {@link archiveRow}: clears the archive columns, nothing else. */
export async function restoreRow(table: ArchivableTable, id: string): Promise<ArchiveResult> {
  const { error } = await db.rpc("admin_restore_row", {
    p_table: table,
    p_id: id,
  });
  return { error };
}
