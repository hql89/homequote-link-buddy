/**
 * import-ingest-queue
 *
 * Accepts candidate businesses parsed from a CSLB export in the browser and
 * stages them in `ingest_queue`. Nothing is published and no email is sent —
 * that happens later, slowly, in `process-ingest-queue`.
 *
 * Parsing happens client-side because the statewide CSLB file is far larger
 * than an edge function can hold. This endpoint therefore treats its input as
 * untrusted and re-applies every filter the browser claims to have applied.
 *
 * Auth: any privileged caller (admin JWT or service role). It writes content that
 * will become public, so it is never open to anon callers.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import {
  corsHeaders,
  json,
  logRun,
  toE164,
  isPrivilegedCaller,
  isActiveLicense,
  isExpired,
  findRawField,
} from "../_shared/directory.ts";

const JOB_NAME = "import-ingest-queue";

/** One request stays well inside the edge function's payload and time budget. */
const MAX_ROWS_PER_REQUEST = 500;

interface Candidate {
  license_number?: string;
  business_name?: string;
  city?: string;
  phone?: string;
  classification?: string;
  vertical_slug?: string;
  raw?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  const startedAt = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    if (!(await isPrivilegedCaller(req))) {
      return json({ success: false, error: "Forbidden" }, 403);
    }

    const payload = (await req.json().catch(() => null)) as { candidates?: Candidate[] } | null;
    const rows = payload?.candidates;
    if (!Array.isArray(rows) || rows.length === 0) {
      return json({ success: false, error: "No candidates supplied." }, 400);
    }
    if (rows.length > MAX_ROWS_PER_REQUEST) {
      return json(
        { success: false, error: `Send at most ${MAX_ROWS_PER_REQUEST} rows per request.` },
        413,
      );
    }

    // Server-side truth for what may be imported. Reading the allowed cities and
    // verticals from the database rather than hardcoding them keeps this in step
    // with the admin UI automatically.
    const [{ data: cfgRow }, { data: verticalRows }] = await Promise.all([
      supabase.from("admin_settings").select("setting_value").eq("setting_key", "ingest_config").maybeSingle(),
      supabase.from("verticals").select("slug").eq("is_active", true),
    ]);

    const cfg = (cfgRow?.setting_value ?? {}) as { cities?: string[] };
    const allowedCities = new Set((cfg.cities ?? []).map((c) => c.toLowerCase()));
    const allowedVerticals = new Set((verticalRows ?? []).map((v: { slug: string }) => v.slug));

    const accepted: Record<string, unknown>[] = [];
    const rejected: Record<string, number> = {};
    const bump = (r: string) => { rejected[r] = (rejected[r] ?? 0) + 1; };

    for (const c of rows) {
      const license = String(c.license_number ?? "").trim();
      const name = String(c.business_name ?? "").trim().slice(0, 200);
      const city = String(c.city ?? "").trim();
      const vertical = String(c.vertical_slug ?? "").trim();
      const phone = toE164(c.phone);

      if (!license) { bump("missing licence number"); continue; }
      if (!name) { bump("missing business name"); continue; }
      if (!allowedCities.has(city.toLowerCase())) { bump("city not configured"); continue; }
      if (!allowedVerticals.has(vertical)) { bump("vertical not active"); continue; }
      if (!phone) { bump("unusable phone"); continue; }
      if (!isActiveLicense(findRawField(c.raw, "status"))) { bump("licence not active"); continue; }
      if (isExpired(findRawField(c.raw, "expires"))) { bump("licence expired"); continue; }

      accepted.push({
        source: "cslb",
        license_number: license,
        business_name: name,
        city,
        phone,
        classification: String(c.classification ?? "").trim().slice(0, 120) || null,
        vertical_slug: vertical,
        raw: c.raw ?? {},
        status: "pending",
      });
    }

    let inserted = 0;
    if (accepted.length > 0) {
      // ignoreDuplicates makes re-importing the same export a no-op rather than
      // an error — the unique index on license_number does the work.
      const { data, error } = await supabase
        .from("ingest_queue")
        .upsert(accepted, { onConflict: "license_number", ignoreDuplicates: true })
        .select("id");

      if (error) throw new Error(`Queue insert failed: ${error.message}`);
      inserted = data?.length ?? 0;
    }

    const duplicates = accepted.length - inserted;

    await logRun(supabase, JOB_NAME, "success", Date.now() - startedAt, null, {
      received: rows.length,
      inserted,
      duplicates,
      rejected,
    });

    return json({
      success: true,
      received: rows.length,
      inserted,
      duplicates,
      rejected,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${JOB_NAME}]`, message);
    await logRun(supabase, JOB_NAME, "failure", Date.now() - startedAt, message, {});
    return json({ success: false, error: "Import failed. Please try again." }, 500);
  }
});
