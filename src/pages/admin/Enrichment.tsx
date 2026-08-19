import { useState, useEffect, useCallback } from "react";
import { PageMeta } from "@/components/PageMeta";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  directoryDb,
  reviewEnrichedEmail,
  setBusinessOutreachPaused,
  setBusinessesOutreachPaused,
  type AdminBusinessRow,
} from "@/integrations/supabase/directory";
import { HelpTip } from "@/components/admin/HelpTip";
import { summariseRun } from "@/lib/jobRunSummary";
import { Loader2, Play, Check, X, Mail, ExternalLink, Send } from "lucide-react";

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

type OutreachReadyRow = Pick<
  AdminBusinessRow,
  "id" | "business_name" | "city" | "phone" | "email" | "outreach_paused" | "outreach_email_1_sent_at"
>;

export default function EnrichmentPage() {
  const [config, setConfig] = useState<EnrichmentConfig>({ daily_limit: 15, enabled: false });
  const [needsReview, setNeedsReview] = useState<NeedsReviewRow[]>([]);
  const [outreachReady, setOutreachReady] = useState<OutreachReadyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  /** Set only while the "Enable all" confirmation is open. */
  const [confirmingBulkEnable, setConfirmingBulkEnable] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [cfgRes, reviewRes, outreachRes, runsRes] = await Promise.all([
      supabase.from("admin_settings").select("setting_value").eq("setting_key", SETTING_KEY).maybeSingle(),
      directoryDb
        .from("businesses")
        .select(
          "id, business_name, city, phone, email, email_source_url, email_source_phone, email_source_address",
        )
        .eq("email_confidence", "needs_review")
        .order("business_name", { ascending: true }),
      directoryDb
        .from("businesses")
        .select("id, business_name, city, phone, email, outreach_paused, outreach_email_1_sent_at")
        .eq("email_confidence", "verified")
        .not("email", "is", null)
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

    if (outreachRes.error) {
      toast({
        title: "Couldn't load outreach list",
        description: outreachRes.error.message,
        variant: "destructive",
      });
    } else {
      setOutreachReady((outreachRes.data ?? []) as OutreachReadyRow[]);
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
      toast({ title: "Search complete" });
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

  async function toggleOutreach(id: string, nextEnabled: boolean) {
    setTogglingId(id);
    const error = await setBusinessOutreachPaused(id, !nextEnabled);
    if (error) {
      toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
    } else {
      setOutreachReady((prev) =>
        prev.map((r) => (r.id === id ? { ...r, outreach_paused: !nextEnabled } : r)),
      );
      toast({ title: nextEnabled ? "Outreach enabled" : "Outreach paused" });
    }
    setTogglingId(null);
  }

  /**
   * Flips every currently-paused row in the list at once. Enabling is gated
   * by a confirmation naming the count — pausing isn't, matching how the
   * cron toggle elsewhere in this admin treats "turn it off" as always
   * safe to do immediately. Only touches rows that are actually paused, so
   * a business someone deliberately re-paused after this list last loaded
   * is left alone rather than being silently re-enabled.
   */
  async function bulkSetOutreachPaused(paused: boolean) {
    const targets = outreachReady.filter((r) => r.outreach_paused === !paused);
    if (targets.length === 0) return;

    setBulkRunning(true);
    const { updated, error } = await setBusinessesOutreachPaused(
      targets.map((r) => r.id),
      paused,
    );
    if (error) {
      toast({
        title: "Couldn't finish",
        description: `${updated} of ${targets.length} updated before this failed: ${error.message}`,
        variant: "destructive",
      });
    } else {
      const updatedIds = new Set(targets.map((r) => r.id));
      setOutreachReady((prev) =>
        prev.map((r) => (updatedIds.has(r.id) ? { ...r, outreach_paused: paused } : r)),
      );
      toast({ title: paused ? `${updated} paused` : `${updated} enabled for outreach` });
    }
    setBulkRunning(false);
  }

  const pausedCount = outreachReady.filter((r) => r.outreach_paused).length;
  const enabledCount = outreachReady.length - pausedCount;

  return (
    <AdminLayout>
      <PageMeta title="Email Finder | Admin" description="Find and verify business email addresses." />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold font-sans">Email Finder</h1>
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
                  <Label>Search automatically</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    When off, "Run now" still works — this only controls whether it would run on a
                    schedule once one exists.
                  </p>
                </div>
                <Switch
                  checked={Boolean(config.enabled)}
                  onCheckedChange={(v) => saveConfig({ enabled: v })}
                  disabled={saving}
                  aria-label="Search for email addresses automatically"
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

            <div className="mt-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold font-sans">Ready for outreach</h2>
                  {pausedCount > 0 && <Badge variant="secondary">{pausedCount} paused</Badge>}
                </div>
                {outreachReady.length > 0 && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={bulkRunning || pausedCount === 0}
                      onClick={() => setConfirmingBulkEnable(true)}
                    >
                      {bulkRunning ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : null}
                      Enable all ({pausedCount})
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={bulkRunning || enabledCount === 0}
                      onClick={() => bulkSetOutreachPaused(true)}
                    >
                      Pause all ({enabledCount})
                    </Button>
                  </div>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Every business starts paused when it's imported, on purpose — nothing gets
                emailed until you turn it on here. This never touches whether the listing page
                itself is published, and turning one on doesn't send anything by itself; the
                outreach job still has to run. Everything in this list already passed the
                phone-match check above, so enabling all of it adds no risk beyond what the daily
                send limit on the Outreach page already controls.
              </p>

              {outreachReady.length === 0 ? (
                <div className="mt-6 flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
                  <Send className="h-8 w-8" aria-hidden="true" />
                  <p className="text-sm">No verified businesses with an email yet.</p>
                </div>
              ) : (
                <ul className="mt-4 space-y-3">
                  {outreachReady.map((row) => (
                    <li key={row.id} className="rounded-lg border border-border bg-card p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">{row.business_name}</p>
                          <p className="text-sm text-muted-foreground">{row.city}</p>
                          <p className="mt-2 text-sm">
                            <span className="font-mono">{row.email}</span>
                          </p>
                          <p className="text-sm text-muted-foreground">Phone: {row.phone ?? "none"}</p>
                          {row.outreach_email_1_sent_at && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Already emailed {new Date(row.outreach_email_1_sent_at).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Label htmlFor={`outreach-${row.id}`} className="text-sm text-muted-foreground">
                            {row.outreach_paused ? "Paused" : "Enabled"}
                          </Label>
                          <Switch
                            id={`outreach-${row.id}`}
                            checked={!row.outreach_paused}
                            onCheckedChange={(v) => toggleOutreach(row.id, v)}
                            disabled={togglingId === row.id}
                            aria-label={`Enable outreach for ${row.business_name}`}
                          />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <AlertDialog open={confirmingBulkEnable} onOpenChange={setConfirmingBulkEnable}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Enable outreach for {pausedCount} businesses?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Every one of these already passed the phone-match check — the phone found on
                    their site matches CSLB's record — so this isn't approving anyone new, just
                    switching all of them on at once instead of one at a time. It does not send
                    anything by itself: the outreach job still has to run, and it still stops at
                    the daily send limit set on the Outreach page.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      setConfirmingBulkEnable(false);
                      bulkSetOutreachPaused(false);
                    }}
                  >
                    Enable {pausedCount}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
