/**
 * purge-archived
 *
 * The only path that permanently destroys a record — and the only one that
 * reclaims its storage. Archiving deliberately leaves files in place so a
 * restore is never broken; this is where that space is finally released.
 *
 * Postgres cannot reach Supabase Storage, so the sequence is driven here:
 *
 *   1. admin_purgeable_refs()  — which rows, and which files belong to them
 *   2. storage.remove()        — delete those files
 *   3. admin_purge_by_ids()    — purge exactly those rows
 *
 * Steps 1 and 3 run as the CALLER, not the service role: the RPCs are gated on
 * is_admin(), which reads auth.uid(), and running them as the caller also
 * means data_audit_log records the actual admin rather than "system". Only the
 * storage deletion uses the service role, because that needs elevated rights.
 *
 * Files are deleted BEFORE rows. If the row delete then fails, the file is
 * gone but the row is still there — archived, visible, and reportable. The
 * reverse order would leave an orphaned file with nothing pointing at it,
 * which nobody could ever find or clean up. A visible inconsistency beats an
 * invisible leak.
 *
 * A file that fails to delete never blocks the purge: it is counted and
 * returned, so the caller can see that space was not fully reclaimed.
 *
 * Auth: admin JWT or service role, same as the other privileged endpoints.
 */
import { serviceRoleKey as readServiceRoleKey, publishableKey as readPublishableKey } from "../_shared/supabaseKeys.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { corsHeaders, json, logRun, isPrivilegedCaller } from "../_shared/directory.ts";
import { resolveStorageRef } from "../_shared/storageRefs.ts";

const JOB_NAME = "purge-archived";

interface PurgeableRow {
  id: string;
  storage_refs: string[] | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  const startedAt = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = readServiceRoleKey();
  const anonKey = readPublishableKey();

  // Service role: storage deletion only.
  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    if (!(await isPrivilegedCaller(req))) {
      return json({ success: false, error: "Forbidden" }, 403);
    }

    const payload = (await req.json().catch(() => null)) as {
      table?: string;
      archived_before?: string;
      limit?: number;
    } | null;

    const table = String(payload?.table ?? "").trim();
    const archivedBefore = String(payload?.archived_before ?? "").trim();
    const limit = Number(payload?.limit ?? 100);

    if (!table) return json({ success: false, error: "table is required." }, 400);
    if (!archivedBefore || Number.isNaN(Date.parse(archivedBefore))) {
      return json(
        { success: false, error: "archived_before must be a valid timestamp." },
        400,
      );
    }
    if (!Number.isFinite(limit) || limit < 1 || limit > 10000) {
      return json({ success: false, error: "limit must be between 1 and 10000." }, 400);
    }

    // Caller-scoped client so is_admin() resolves and the audit trail names
    // the real actor. The whitelist and admin check live in the RPCs.
    const authHeader = req.headers.get("Authorization") ?? "";
    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ── 1. What is about to go, and what files belong to it ────────────────
    const { data: refsData, error: refsError } = await caller.rpc("admin_purgeable_refs", {
      p_table: table,
      p_before: archivedBefore,
      p_limit: limit,
    });
    if (refsError) throw new Error(`Could not list purgeable rows: ${refsError.message}`);

    const rows = (refsData ?? []) as PurgeableRow[];
    if (rows.length === 0) {
      await logRun(admin, JOB_NAME, "success", Date.now() - startedAt, null, {
        table, purged: 0, files_deleted: 0, files_failed: 0,
      });
      return json({ success: true, table, purged: 0, files_deleted: 0, files_failed: 0 });
    }

    // ── 2. Delete the files, grouped per bucket ────────────────────────────
    const byBucket = new Map<string, string[]>();
    const unresolved: string[] = [];

    for (const row of rows) {
      for (const ref of row.storage_refs ?? []) {
        const resolved = resolveStorageRef(ref, table);
        if (!resolved) {
          unresolved.push(ref);
          continue;
        }
        const paths = byBucket.get(resolved.bucket) ?? [];
        paths.push(resolved.path);
        byBucket.set(resolved.bucket, paths);
      }
    }

    let filesDeleted = 0;
    let filesFailed = unresolved.length;
    const fileErrors: string[] = unresolved.map((r) => `unrecognised reference: ${r}`);

    for (const [bucket, paths] of byBucket) {
      const { data, error } = await admin.storage.from(bucket).remove(paths);
      if (error) {
        filesFailed += paths.length;
        fileErrors.push(`${bucket}: ${error.message}`);
        // Deliberately not fatal — the rows should still be purged, and the
        // caller is told the space was not fully reclaimed.
        console.error(`[${JOB_NAME}] storage delete failed for ${bucket}:`, error.message);
        continue;
      }
      filesDeleted += data?.length ?? paths.length;
    }

    // ── 3. Purge exactly the rows we just cleared files for ────────────────
    const { data: purgeData, error: purgeError } = await caller.rpc("admin_purge_by_ids", {
      p_table: table,
      p_ids: rows.map((r) => r.id),
    });
    if (purgeError) throw new Error(`Purge failed: ${purgeError.message}`);

    const purged = (purgeData as { purged?: number } | null)?.purged ?? 0;
    const status = filesFailed > 0 ? "partial" : "success";

    await logRun(
      admin,
      JOB_NAME,
      status,
      Date.now() - startedAt,
      fileErrors.length ? fileErrors.slice(0, 5).join(" | ") : null,
      { table, purged, files_deleted: filesDeleted, files_failed: filesFailed },
    );

    return json({
      success: true,
      table,
      purged,
      files_deleted: filesDeleted,
      files_failed: filesFailed,
      ...(fileErrors.length ? { file_errors: fileErrors.slice(0, 10) } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${JOB_NAME}]`, message);
    await logRun(admin, JOB_NAME, "failure", Date.now() - startedAt, message, {});
    return json({ success: false, error: message }, 500);
  }
});
