/**
 * process-ingest-queue
 *
 * Drains `ingest_queue` into `businesses` at an admin-configurable daily rate.
 *
 * Deliberately SILENT. Rows are created unpublished, with outreach paused, and
 * no email is sent. Publishing and outreach are separate, explicit admin
 * actions — an engine that both ingests at volume and auto-sends cold email
 * would burn the sending domain and create compliance exposure before anyone
 * noticed.
 *
 * This does NOT call `ingest-business`: that endpoint's contract is
 * create-and-email, which is the opposite of what's wanted here.
 *
 * Auth: any privileged caller (admin JWT or service role) — see isPrivilegedCaller.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { corsHeaders, json, logRun, slugify, toE164, isPrivilegedCaller } from "../_shared/directory.ts";
import { displayBusinessName } from "../_shared/cslbNames.ts";

const JOB_NAME = "process-ingest-queue";

const DEFAULT_DAILY_LIMIT = 25;
/** Guards against a fat-fingered admin value turning into a mass insert. */
const MAX_DAILY_LIMIT = 500;

interface IngestConfig {
  daily_limit?: number;
  enabled?: boolean;
  cities?: string[];
}

interface QueueRow {
  id: string;
  license_number: string | null;
  business_name: string;
  city: string | null;
  phone: string | null;
  vertical_slug: string | null;
  /** The original CSLB columns. Carries BusinessType and FullBusinessName,
   *  which together decide the name a homeowner actually sees. */
  raw: Record<string, unknown> | null;
}

/** Marks a queue row terminal. Failures here are logged, never thrown — one bad row must not stall the batch. */
async function finish(
  supabase: SupabaseClient,
  id: string,
  status: "ingested" | "skipped" | "failed",
  extra: Record<string, unknown> = {},
) {
  const { error } = await supabase
    .from("ingest_queue")
    .update({ status, processed_at: new Date().toISOString(), ...extra })
    .eq("id", id);
  if (error) console.error(`[${JOB_NAME}] could not mark ${id} ${status}:`, error.message);
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

    const { data: cfgRow } = await supabase
      .from("admin_settings").select("setting_value").eq("setting_key", "ingest_config").maybeSingle();
    const cfg = (cfgRow?.setting_value ?? {}) as IngestConfig;

    if (cfg.enabled === false) {
      await logRun(supabase, JOB_NAME, "success", Date.now() - startedAt, null, { skipped: "disabled" });
      return json({ success: true, disabled: true, ingested: 0, skipped: 0, failed: 0 });
    }

    const limit = Math.min(
      Math.max(1, Number(cfg.daily_limit) || DEFAULT_DAILY_LIMIT),
      MAX_DAILY_LIMIT,
    );

    const { data: queue, error: queueError } = await supabase
      .from("ingest_queue")
      .select("id, license_number, business_name, city, phone, vertical_slug, raw")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (queueError) throw new Error(`Queue read failed: ${queueError.message}`);

    const rows = (queue ?? []) as QueueRow[];
    let ingested = 0, skipped = 0, failed = 0;

    for (const row of rows) {
      try {
        const phone = toE164(row.phone);
        const city = (row.city ?? "").trim();
        if (!phone || !city) {
          await finish(supabase, row.id, "skipped", { skip_reason: "missing phone or city" });
          skipped++;
          continue;
        }

        // Already in the directory? Licence number first, since it's stable.
        if (row.license_number) {
          const { data: existing } = await supabase
            .from("businesses").select("id").eq("license_number", row.license_number).maybeSingle();
          if (existing) {
            await finish(supabase, row.id, "skipped", {
              skip_reason: "already in directory",
              business_id: existing.id,
            });
            skipped++;
            continue;
          }
        }

        // CSLB stores names upper case, and a licence held by an individual
        // under their own name is stored surname-first ("GREKOV GEORGIY").
        // Both are wrong on a public listing, so normalise before anything
        // derived from the name — including the slug — is computed.
        const displayName = displayBusinessName(row.business_name, row.raw) || row.business_name;

        const citySlug = slugify(city);
        const baseSlug = slugify(displayName) || `business-${row.license_number ?? row.id.slice(0, 8)}`;

        // (city_slug, slug) is uniquely indexed. Two different licensed
        // businesses can share a trading name in the same city, so fall back to
        // a licence-derived suffix rather than failing the row.
        let slug = baseSlug;
        const { data: slugTaken } = await supabase
          .from("businesses").select("id").eq("city_slug", citySlug).eq("slug", slug).maybeSingle();
        if (slugTaken) {
          const suffix = (row.license_number ?? row.id).replace(/\D/g, "").slice(-4) || "2";
          slug = `${baseSlug}-${suffix}`;
        }

        const { data: created, error: insertError } = await supabase
          .from("businesses")
          .insert({
            business_name: displayName,
            slug,
            city,
            city_slug: citySlug,
            phone,
            license_number: row.license_number,
            license_status: "ACTIVE",
            source: "cslb",
            services: [],
            // The two flags that make this ingestion silent.
            is_published: false,
            outreach_paused: true,
          })
          .select("id")
          .single();

        if (insertError) throw new Error(insertError.message);

        await finish(supabase, row.id, "ingested", { business_id: created.id });
        ingested++;
      } catch (rowErr) {
        const message = rowErr instanceof Error ? rowErr.message : String(rowErr);
        console.error(`[${JOB_NAME}] row ${row.id} failed:`, message);
        await finish(supabase, row.id, "failed", { skip_reason: message.slice(0, 300) });
        failed++;
      }
    }

    await logRun(supabase, JOB_NAME, failed > 0 ? "partial" : "success", Date.now() - startedAt, null, {
      limit, considered: rows.length, ingested, skipped, failed,
    });

    return json({ success: true, considered: rows.length, ingested, skipped, failed, limit });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${JOB_NAME}]`, message);
    await logRun(supabase, JOB_NAME, "failure", Date.now() - startedAt, message, {});
    return json({ success: false, error: "Ingestion run failed." }, 500);
  }
});
