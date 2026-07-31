/**
 * Shared helpers for the directory / outreach engine.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** URL-safe slug. Returns "" for input that has no usable characters. */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Replaces {{variable}} tokens. Unknown tokens collapse to an empty string. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => vars[key] ?? "");
}

/**
 * Very small E.164 normaliser for US numbers. Returns null when the input
 * cannot be confidently converted — callers must treat null as "do not call".
 */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\+[1-9]\d{7,14}$/.test(trimmed)) return trimmed;

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/**
 * CSLB licence status/expiry checks, mirroring src/lib/cslb.ts's
 * `isActiveLicense`/`isExpired`. Duplicated rather than imported because Deno
 * edge functions cannot import from src/ — see import-ingest-queue's
 * docstring on why the browser's filters must be re-applied here too.
 */
const ACTIVE_LICENSE_STATUSES = new Set(["CLEAR", "ACTIVE"]);

export function isActiveLicense(status: string | null | undefined): boolean {
  return ACTIVE_LICENSE_STATUSES.has(String(status ?? "").trim().toUpperCase());
}

/** CSLB dates are MM/DD/YYYY. An unparseable date is treated as "not expired". */
export function isExpired(raw: string | null | undefined, now: Date = new Date()): boolean {
  const m = String(raw ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return false;
  const [, mm, dd, yyyy] = m;
  const expiry = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return expiry.getTime() < now.getTime();
}

const RAW_FIELD_ALIASES: Record<"status" | "expires", string[]> = {
  status: ["primarystatus", "licensestatus", "status"],
  expires: ["expirationdate", "expiration", "expiresdate", "expdate"],
};

function rawHeaderKey(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Reads a field out of a candidate's `raw` object. `raw`'s keys are the
 * original CSV column headers (e.g. "PrimaryStatus"), not normalised field
 * names, so this matches the same header aliases src/lib/cslb.ts's
 * `mapHeaders` uses client-side rather than a single hardcoded key.
 */
export function findRawField(
  raw: Record<string, unknown> | null | undefined,
  field: "status" | "expires",
): string | undefined {
  if (!raw) return undefined;
  const aliases = RAW_FIELD_ALIASES[field];
  for (const [key, value] of Object.entries(raw)) {
    if (aliases.includes(rawHeaderKey(key))) return String(value ?? "").trim();
  }
  return undefined;
}

export interface OutreachTemplate {
  subject: string;
  body: string;
}

/**
 * Blueprint-specified copy. Email 1 deliberately contains no links or HTML to
 * maximise deliverability on a cold send; Email 2 carries the claim link.
 */
export const DEFAULT_OUTREACH_TEMPLATES: Record<string, OutreachTemplate> = {
  outreach_verify: {
    subject: "Quick question about {{business_name}} in {{city}}",
    body:
      "Hi {{owner_name}},\n\n" +
      "I built a local directory for {{city}} businesses and added {{business_name}}. " +
      "I want to make sure your phone number ({{phone}}) is correct before we push it live.\n\n" +
      "If it is correct, please reply YES. If not, let me know what to change.\n\n" +
      "Best,\n{{sender_name}}",
  },
  outreach_preview: {
    subject: "Your {{city}} listing is ready for preview",
    body:
      "Hi {{owner_name}},\n\n" +
      "Here is the live listing we set up for you:\n{{claim_url}}\n\n" +
      "It's free to claim, and here's exactly what that means: once you do, homeowners " +
      "can request quotes straight from the page. Every request goes only to you — we " +
      "never sell or share it, and there's no fee or commission. Your own phone number is " +
      "on the page too, so calls go directly to you, not through us.\n\n" +
      "Claiming takes under a minute — just confirm your email and phone.\n\n" +
      "Best,\n{{sender_name}}",
  },
};

/**
 * Loads admin-editable outreach templates, falling back to the defaults above
 * for any template the admin has not customised.
 */
export async function loadOutreachTemplates(
  supabase: SupabaseClient,
): Promise<Record<string, OutreachTemplate>> {
  const { data } = await supabase
    .from("admin_settings")
    .select("setting_value")
    .eq("setting_key", "outreach_templates")
    .maybeSingle();

  const custom = (data?.setting_value ?? {}) as Record<string, Partial<OutreachTemplate>>;
  const merged: Record<string, OutreachTemplate> = {};

  for (const [key, fallback] of Object.entries(DEFAULT_OUTREACH_TEMPLATES)) {
    merged[key] = {
      subject: custom[key]?.subject?.trim() || fallback.subject,
      body: custom[key]?.body?.trim() || fallback.body,
    };
  }
  return merged;
}

export interface PerplexityConfig {
  api_key?: string;
  enabled?: boolean;
}

/**
 * Loads the Perplexity key from `admin_settings.perplexity_config`, written by
 * PerplexitySettings.tsx. Deliberately NOT a Supabase secret (`Deno.env`) —
 * see implementation_plan.md's "Storage — corrected 2026-07-29" note. The key
 * itself is never logged.
 */
export async function loadPerplexityConfig(
  supabase: SupabaseClient,
): Promise<{ config: PerplexityConfig | null; error: string | null }> {
  const { data, error } = await supabase
    .from("admin_settings")
    .select("setting_value")
    .eq("setting_key", "perplexity_config")
    .maybeSingle();

  if (error) return { config: null, error: `Failed to read Perplexity settings: ${error.message}` };
  if (!data?.setting_value) {
    return { config: null, error: "Perplexity is not configured. Go to Admin → Settings to add a key." };
  }
  return { config: data.setting_value as PerplexityConfig, error: null };
}

export interface EnrichmentConfig {
  daily_limit: number;
  enabled: boolean;
}

const DEFAULT_ENRICHMENT_CONFIG: EnrichmentConfig = { daily_limit: 15, enabled: false };

/**
 * Loads `admin_settings.enrichment_config`, falling back to a conservative
 * default (disabled, 15/day) when no admin has ever saved one — same lazy-
 * default pattern as `ingest_config`, so no seed migration is needed.
 */
export async function loadEnrichmentConfig(supabase: SupabaseClient): Promise<EnrichmentConfig> {
  const { data } = await supabase
    .from("admin_settings")
    .select("setting_value")
    .eq("setting_key", "enrichment_config")
    .maybeSingle();

  if (!data?.setting_value) return DEFAULT_ENRICHMENT_CONFIG;
  const cfg = data.setting_value as Partial<EnrichmentConfig>;
  return {
    daily_limit: typeof cfg.daily_limit === "number" && cfg.daily_limit > 0 ? cfg.daily_limit : DEFAULT_ENRICHMENT_CONFIG.daily_limit,
    enabled: Boolean(cfg.enabled),
  };
}

/**
 * Authorises a privileged caller by capability rather than by string-matching a
 * key.
 *
 * The obvious check — `token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")` —
 * is what `ingest-business` does, and it silently stopped working: the value in
 * the function's environment no longer equals the project's service-role key,
 * so that endpoint rejects the very credential its docstring says to use.
 *
 * Instead, replay the caller's own token against a table that RLS closes to
 * everyone but admins (`admin_settings`). Service-role bypasses RLS, an admin
 * JWT satisfies the policy, and anon or an ordinary signed-in user gets an
 * error. That holds true across key rotations and key-format migrations.
 */
export async function isPrivilegedCaller(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return false;

  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.98.0");
    const caller = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Absence of an error is NOT sufficient: RLS filters rows rather than
    // raising, so an anon caller gets 200 with an empty set. Require rows back.
    // `admin_settings` is always populated (smtp_config, ingest_config, …), so
    // zero rows means the caller was filtered out, not that the table is empty.
    const { count, error } = await caller
      .from("admin_settings")
      .select("setting_key", { count: "exact", head: true });
    return !error && (count ?? 0) > 0;
  } catch (err) {
    console.error("[isPrivilegedCaller] check failed:", err);
    return false;
  }
}

/** Writes a row to the shared job_run_logs table, matching existing functions. */
export async function logRun(
  supabase: SupabaseClient,
  jobName: string,
  status: "success" | "failure" | "partial",
  durationMs: number,
  errorMessage: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from("job_run_logs").insert({
      job_name: jobName,
      status,
      attempts: 1,
      duration_ms: durationMs,
      error_message: errorMessage,
      metadata,
    });
  } catch (err) {
    console.error(`[${jobName}] failed to write job_run_logs:`, err);
  }
}
