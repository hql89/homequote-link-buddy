import { useState, useEffect, useCallback } from "react";
import { PageMeta } from "@/components/PageMeta";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { directoryDb, reviewEnrichedEmail, type AdminBusinessRow } from "@/integrations/supabase/directory";
import { HelpTip } from "@/components/admin/HelpTip";
import { summariseRun } from "@/lib/jobRunSummary";
import { Loader2, Play, Check, X, Mail, ExternalLink } from "lucide-react";

const SETTING_KEY = "enrichment_config";

interface EnrichmentConfig {
  daily_limit?: number;
  enabled?: boolean;
}

type NeedsReviewRow = Pick<
  AdminBusinessRow,
  | "id"
  | "business_name"
  | "city"
  | "phone"
  | "email"
  | "email_source_url"
  | "email_source_phone"
  | "email_source_address"
>;

export default function EnrichmentPage() {
  const [config, setConfig] = useState<EnrichmentConfig>({ daily_limit: 15, enabled: false });
  const [needsReview, setNeedsReview] = useState<NeedsReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [cfgRes, reviewRes, runsRes] = await Promise.all([
      supabase.from("admin_settings").select("setting_value").eq("setting_key", SETTING_KEY).maybeSingle(),
      directoryDb
        .from("businesses")
        .select(
          "id, business_name, city, phone, email, email_source_url, email_source_phone, email_source_address",
        )
        .eq("email_confidence", "needs_review")
        .order("business_name", { ascending: true }),
      supabase.rpc("admin_recent_job_runs", { p_limit: 25 }),
    ]);

    if (cfgRes.data?.setting_value) {
      setConfig({ daily_limit: 15, enabled: false, ...(cfgRes.data.setting_value as EnrichmentConfig) });
    }

    if (reviewRes.error) {
      toast({ title: "Couldn't load review queue", description: reviewRes.error.message, variant: "destructive" });
    } else {
      setNeedsReview((reviewRes.data ?? []) as NeedsReviewRow[]);
    }

    const runs = (runsRes.data ?? []) as { job_name: string; metadata: Record<string, unknown> }[];
    const latest = runs.find((r) => r.job_name === "enrich-business-email");
    if (latest) {
      const { text } = summariseRun(latest.job_name, latest.metadata);
      setLastRun(text);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveConfig(patch: Partial<EnrichmentConfig>) {
    setSaving(true);
    const next = { ...config, ...patch };
    const { error } = await supabase
      .from("admin_settings")
      .upsert({ setting_key: SETTING_KEY, setting_value: next }, { onConflict: "setting_key" });
    if (error) {
      toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
    } else {
      setConfig(next);
    }
    setSaving(false);
  }

  async function runNow() {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("enrich-business-email", { body: {} });
      if (error || data?.success === false) {
        throw new Error(data?.error ?? error?.message ?? "Run failed.");
      }
      toast({ title: "Enrichment run complete" });
      await load();
    } catch (err) {
      toast({
        title: "Run failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setRunning(false);
    }
  }

  async function review(id: string, decision: "verified" | "rejected") {
    setReviewingId(id);
    const error = await reviewEnrichedEmail(id, decision);
    if (error) {
      toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
    } else {
      setNeedsReview((prev) => prev.filter((r) => r.id !== id));
      toast({ title: decision === "verified" ? "Confirmed" : "Dismissed" });
    }
    setReviewingId(null);
  }

  return (
    <AdminLayout>
      <PageMeta title="Email Enrichment | Admin" description="Discover and verify business email addresses." />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold font-sans">Email Enrichment</h1>
          <HelpTip>
            CSLB doesn't publish email addresses, so nothing in the directory has one until this
            runs. It asks Perplexity for a business's website — never for their email or phone,
            only a URL — then fetches that page itself and looks for an email and a phone number
            on it. A row only becomes eligible for outreach when the phone found on the page
            matches the one CSLB has on file; otherwise it lands below for you to confirm by eye.
            It also pulls a "City, CA zip" snippet from the page if one is there — that never
            decides anything automatically, but it's shown next to CSLB's city so you can spot a
            business whose site clearly lists an address outside the service area.
          </HelpTip>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Outreach can't email a business until this has found and verified an address for it.
        </p>

        {loading ? (
          <div className="mt-10 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        ) : (
          <>
            <div className="mt-6 rounded-lg border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Enable enrichment</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    When off, "Run now" still works — this only controls whether it would run on a
                    schedule once one exists.
                  </p>
                </div>
                <Switch
                  checked={Boolean(config.enabled)}
                  onCheckedChange={(v) => saveConfig({ enabled: v })}
                  disabled={saving}
                  aria-label="Enable enrichment"
                />
              </div>

              <div className="mt-4 flex items-end gap-3">
                <div>
                  <Label htmlFor="daily-limit">Daily limit</Label>
                  <Input
                    id="daily-limit"
                    type="number"
                    min={1}
                    max={100}
                    className="mt-1 w-28"
                    value={config.daily_limit ?? 15}
                    onChange={(e) => setConfig({ ...config, daily_limit: Number(e.target.value) })}
                    onBlur={(e) =>
                      saveConfig({ daily_limit: Math.min(100, Math.max(1, Number(e.target.value) || 15)) })
                    }
                  />
                </div>
                <Button onClick={runNow} disabled={running}>
                  {running ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Running…</>
                  ) : (
                    <><Play className="mr-2 h-4 w-4" aria-hidden="true" />Run now</>
                  )}
                </Button>
              </div>
              {lastRun && <p className="mt-3 text-xs text-muted-foreground">Last run: {lastRun}</p>}
            </div>

            <div className="mt-8">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold font-sans">Needs review</h2>
                {needsReview.length > 0 && <Badge variant="secondary">{needsReview.length}</Badge>}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                An email was found, but the phone number on the page didn't match CSLB's — confirm
                this is really the right business before it becomes eligible for outreach.
              </p>

              {needsReview.length === 0 ? (
                <div className="mt-6 flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
                  <Mail className="h-8 w-8" aria-hidden="true" />
                  <p className="text-sm">Nothing waiting for review.</p>
                </div>
              ) : (
                <ul className="mt-4 space-y-3">
                  {needsReview.map((row) => (
                    <li key={row.id} className="rounded-lg border border-border bg-card p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{row.business_name}</p>
                          <p className="text-sm text-muted-foreground">{row.city}</p>
                          <p className="mt-2 text-sm">
                            Found: <span className="font-mono">{row.email}</span>
                          </p>
                          <p className="text-sm text-muted-foreground">CSLB city on file: {row.city}</p>
                          <p className="text-sm text-muted-foreground">CSLB phone on file: {row.phone ?? "none"}</p>
                          <p className="text-sm text-muted-foreground">
                            Phone on site: {row.email_source_phone ?? "none found"}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Address on site:{" "}
                            {row.email_source_address ?? "none found"}
                          </p>
                          {row.email_source_url && (
                            <a
                              href={row.email_source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 inline-flex items-center gap-1 text-sm text-accent hover:underline"
                            >
                              View source page <ExternalLink className="h-3 w-3" aria-hidden="true" />
                            </a>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="gap-1"
                            disabled={reviewingId === row.id}
                            onClick={() => review(row.id, "verified")}
                          >
                            <Check className="h-3.5 w-3.5" aria-hidden="true" />
                            Confirm
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1"
                            disabled={reviewingId === row.id}
                            onClick={() => review(row.id, "rejected")}
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                            Dismiss
                          </Button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
