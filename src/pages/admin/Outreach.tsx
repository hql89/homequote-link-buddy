import { useState, useEffect, useCallback } from "react";
import { PageMeta } from "@/components/PageMeta";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  createOutreachVariant,
  deleteOutreachVariant,
  loadOutreachVariants,
  saveOutreachVariant,
  type OutreachEmailType,
  type OutreachVariantRow,
  type OutreachVariantStats,
} from "@/integrations/supabase/directory";
import { HelpTip } from "@/components/admin/HelpTip";
import { summariseRun } from "@/lib/jobRunSummary";
import { computeOutreachReadiness } from "@/lib/outreachReadiness";
import { OutreachReadiness } from "@/components/admin/OutreachReadiness";
import { looksLikeItContainsLink, renderPreview, OUTREACH_MERGE_FIELDS } from "@/lib/outreachCopy";
import { Loader2, Play, Plus, Trash2, AlertTriangle, Save, Mail } from "lucide-react";

const SETTING_KEY = "outreach_config";
const DEFAULT_DAILY_LIMIT = 10;

/** Keeps the editor, and the sample-size maths, from sprawling. */
const MAX_VARIANTS_PER_STAGE = 3;

const STAGES: { key: OutreachEmailType; label: string; blurb: string }[] = [
  {
    key: "outreach_verify",
    label: "Email 1 — phone verification",
    blurb:
      "The first cold email. Asks the owner to confirm their phone number and reply YES. Sent to any business you've switched on in Email Finder that hasn't been contacted yet.",
  },
  {
    key: "outreach_preview",
    label: "Email 2 — listing preview",
    blurb:
      "Follow-up, sent 3 days after Email 1 to anyone who hasn't claimed their listing. This is the one that carries the claim link.",
  },
];

/** Stand-in values for the preview when no real business is available yet. */
const EXAMPLE_VARS: Record<string, string> = {
  business_name: "Valley Roofing Co",
  city: "Van Nuys",
  owner_name: "Dana",
  phone: "(818) 555-0142",
  claim_url: "https://homequotelink.com/directory/van-nuys/valley-roofing-co/claim?token=…",
  sender_name: "The Directory Team",
};

interface PreviewBusiness {
  business_name: string;
  city: string;
  owner_name: string | null;
  phone: string | null;
}

export default function OutreachPage() {
  const [variants, setVariants] = useState<OutreachVariantRow[]>([]);
  const [stats, setStats] = useState<OutreachVariantStats[]>([]);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [dailyLimit, setDailyLimit] = useState<number>(DEFAULT_DAILY_LIMIT);
  const [bccEmail, setBccEmail] = useState<string>("");
  const [savedBcc, setSavedBcc] = useState<string>("");
  const [savingBcc, setSavingBcc] = useState(false);
  const [sampleBusiness, setSampleBusiness] = useState<PreviewBusiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingLimit, setSavingLimit] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  /** Counts behind the readiness panel. Null while unknown, so the panel can
   *  say "couldn't read this" rather than rendering a confident zero. */
  const [eligibleCount, setEligibleCount] = useState(0);
  const [pausedWithEmail, setPausedWithEmail] = useState(0);
  const [needsReviewCount, setNeedsReviewCount] = useState(0);
  const [sentToday, setSentToday] = useState(0);
  const [cronActive, setCronActive] = useState<boolean | null>(null);
  const [deliveryVerifiedAt, setDeliveryVerifiedAt] = useState<string | null>(null);
  /** Unsaved edits, keyed by variant id. */
  const [drafts, setDrafts] = useState<Record<string, Partial<OutreachVariantRow>>>({});

  const load = useCallback(async () => {
    setLoading(true);

    const [cfgRes, variantRes, statsRes, sampleRes, runsRes, eligibleRes, pausedRes, reviewRes, sentTodayRes, cronRes] =
      await Promise.all([
      supabase.from("admin_settings").select("setting_value").eq("setting_key", SETTING_KEY).maybeSingle(),
      loadOutreachVariants(),
      supabase.rpc("admin_outreach_variant_stats"),
      supabase
        .from("businesses")
        .select("business_name, city, owner_name, phone")
        .eq("email_confidence", "verified")
        .eq("outreach_paused", false)
        .limit(1)
        .maybeSingle(),
      supabase.rpc("admin_recent_job_runs", { p_limit: 25 }),
      // Eligible = exactly what send-outreach-drip's Email 1 query selects, so
      // the panel's count is the job's count and cannot drift into optimism.
      supabase
        .from("businesses")
        .select("id", { count: "exact", head: true })
        .eq("email_confidence", "verified")
        .eq("outreach_paused", false)
        .is("outreach_suppressed_at", null)
        .is("email_undeliverable_at", null)
        .is("outreach_email_1_sent_at", null)
        .not("email", "is", null),
      supabase
        .from("businesses")
        .select("id", { count: "exact", head: true })
        .eq("email_confidence", "verified")
        .eq("outreach_paused", true)
        .not("email", "is", null),
      supabase
        .from("businesses")
        .select("id", { count: "exact", head: true })
        .eq("email_confidence", "needs_review"),
      supabase
        .from("outreach_sends")
        .select("id", { count: "exact", head: true })
        .gte("sent_at", new Date(Date.UTC(
          new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(),
        )).toISOString()),
      supabase.rpc("admin_list_cron_jobs"),
    ]);

    const cfg = (cfgRes.data?.setting_value ?? {}) as {
      daily_limit?: number;
      bcc_email?: string;
      delivery_verified_at?: string;
    };
    setDeliveryVerifiedAt(cfg.delivery_verified_at ?? null);
    setDailyLimit(Number.isFinite(cfg.daily_limit) ? Number(cfg.daily_limit) : DEFAULT_DAILY_LIMIT);
    setBccEmail(cfg.bcc_email ?? "");
    setSavedBcc(cfg.bcc_email ?? "");

    if (variantRes.error) {
      toast({
        title: "Couldn't load templates",
        description: variantRes.error.message,
        variant: "destructive",
      });
    } else {
      setVariants(variantRes.variants);
      setDrafts({});
    }

    // Results failing to load is distinct from there being no results yet —
    // rendering "0 sent" for an unreadable table would be a claim we can't make.
    if (statsRes.error) {
      setStatsError(statsRes.error.message);
      setStats([]);
    } else {
      setStatsError(null);
      setStats((statsRes.data ?? []) as OutreachVariantStats[]);
    }

    setSampleBusiness((sampleRes.data ?? null) as PreviewBusiness | null);

    const runs = (runsRes.data ?? []) as { job_name: string; metadata: Record<string, unknown> }[];
    const latest = runs.find((r) => r.job_name === "send-outreach-drip");
    setLastRun(latest ? summariseRun(latest.job_name, latest.metadata).text : null);

    setEligibleCount(eligibleRes.count ?? 0);
    setPausedWithEmail(pausedRes.count ?? 0);
    setNeedsReviewCount(reviewRes.count ?? 0);
    setSentToday(sentTodayRes.count ?? 0);

    // null, not false, when the schedule is unreadable — pg_cron may not even
    // be installed, and "off" would assert something nobody checked.
    const cronJobs = (cronRes.data ?? null) as { jobname: string; active: boolean }[] | null;
    setCronActive(
      cronRes.error || !cronJobs
        ? null
        : (cronJobs.find((j) => j.jobname === "send-outreach-drip-daily")?.active ?? false),
    );

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveDailyLimit(next: number) {
    // `|| DEFAULT` would be wrong here: typing 0 is falsy, so it would land on
    // 10 — a nonsense entry silently RAISING the send rate. Only a genuinely
    // unusable value (empty field, NaN) falls back to the default; a real
    // number is clamped, so 0 becomes 1 rather than 10.
    const parsed = Number.isFinite(next) ? Math.floor(next) : DEFAULT_DAILY_LIMIT;
    const clamped = Math.min(500, Math.max(1, parsed));
    setSavingLimit(true);

    // Merge rather than overwrite: this row also holds delivery_verified_at,
    // written by the SMTP settings page. Replacing the whole value would drop
    // the delivery proof and silently halt outreach.
    const { data: existing } = await supabase
      .from("admin_settings")
      .select("setting_value")
      .eq("setting_key", SETTING_KEY)
      .maybeSingle();

    const merged = {
      ...((existing?.setting_value as Record<string, unknown>) ?? {}),
      daily_limit: clamped,
    };

    const { error } = await supabase
      .from("admin_settings")
      .upsert({ setting_key: SETTING_KEY, setting_value: merged }, { onConflict: "setting_key" });

    if (error) {
      toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
    } else {
      setDailyLimit(clamped);
      toast({ title: `Daily limit set to ${clamped}` });
    }
    setSavingLimit(false);
  }

  /**
   * Saves (or clears) the testing copy address.
   *
   * The real enforcement is server-side in `resolveBccCopy` — this check just
   * turns the mistake into an explanation at the moment it's made, instead of
   * copies silently never arriving. Deliberately reads only the two sending
   * identity keys via `->>` rather than the whole smtp_config blob, so the
   * stored SMTP password never travels to the browser for a validation.
   */
  async function saveBccEmail(next: string) {
    const trimmed = next.trim();
    setSavingBcc(true);

    if (trimmed) {
      const { data: idRow } = await supabase
        .from("admin_settings")
        .select("from_email:setting_value->>fromEmail, smtp_username:setting_value->>smtpUsername")
        .eq("setting_key", "smtp_config")
        .maybeSingle();

      const identity = (idRow ?? {}) as { from_email?: string; smtp_username?: string };
      const lowered = trimmed.toLowerCase();
      const isOwnAddress =
        lowered === (identity.from_email ?? "").trim().toLowerCase() ||
        lowered === (identity.smtp_username ?? "").trim().toLowerCase();

      if (isOwnAddress) {
        toast({
          title: "Can't copy to the sending address",
          description:
            "That's the mailbox the inbound bridge watches — copies would come back in as if " +
            "businesses had replied. Use a different inbox, like your personal email.",
          variant: "destructive",
        });
        setSavingBcc(false);
        return;
      }

      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
        toast({ title: "That doesn't look like an email address", variant: "destructive" });
        setSavingBcc(false);
        return;
      }
    }

    // Merge, for the same reason saveDailyLimit does: this row also carries
    // delivery_verified_at and daily_limit.
    const { data: existing } = await supabase
      .from("admin_settings")
      .select("setting_value")
      .eq("setting_key", SETTING_KEY)
      .maybeSingle();

    const merged = { ...((existing?.setting_value as Record<string, unknown>) ?? {}) };
    if (trimmed) merged.bcc_email = trimmed;
    else delete merged.bcc_email;

    const { error } = await supabase
      .from("admin_settings")
      .upsert({ setting_key: SETTING_KEY, setting_value: merged }, { onConflict: "setting_key" });

    if (error) {
      toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
    } else {
      setSavedBcc(trimmed);
      setBccEmail(trimmed);
      toast({
        title: trimmed ? `Copies will go to ${trimmed}` : "Copies turned off",
      });
    }
    setSavingBcc(false);
  }

  function draftOf(v: OutreachVariantRow): OutreachVariantRow {
    return { ...v, ...drafts[v.id] };
  }

  function edit(id: string, patch: Partial<OutreachVariantRow>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function save(v: OutreachVariantRow) {
    const merged = draftOf(v);
    setSavingId(v.id);
    const error = await saveOutreachVariant(v.id, {
      subject: merged.subject,
      body: merged.body,
      weight: merged.weight,
      is_active: merged.is_active,
    });
    if (error) {
      toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
    } else {
      setVariants((prev) => prev.map((row) => (row.id === v.id ? merged : row)));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[v.id];
        return next;
      });
      toast({ title: `Variant ${v.variant_key} saved` });
    }
    setSavingId(null);
  }

  async function addVariant(stage: OutreachEmailType) {
    const existing = variants.filter((v) => v.email_type === stage);
    if (existing.length >= MAX_VARIANTS_PER_STAGE) return;

    // Next unused letter, so keys stay stable even after a delete.
    const used = new Set(existing.map((v) => v.variant_key));
    const key = ["A", "B", "C", "D", "E"].find((k) => !used.has(k)) ?? `V${existing.length + 1}`;
    const seed = existing[0];

    const error = await createOutreachVariant({
      email_type: stage,
      variant_key: key,
      subject: seed?.subject ?? "",
      body: seed?.body ?? "",
    });
    if (error) {
      toast({ title: "Couldn't add variant", description: error.message, variant: "destructive" });
    } else {
      toast({
        title: `Variant ${key} added`,
        description: "It starts switched off — turn it on once the copy is ready.",
      });
      await load();
    }
  }

  async function removeVariant(v: OutreachVariantRow) {
    const error = await deleteOutreachVariant(v.id);
    if (error) {
      toast({ title: "Couldn't remove", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Variant ${v.variant_key} removed` });
      await load();
    }
  }

  async function runNow() {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-outreach-drip", { body: {} });
      if (error || data?.success === false) {
        throw new Error(data?.error ?? error?.message ?? "Run failed.");
      }
      // A halt is a successful, deliberate outcome — surface the reason
      // rather than reporting "done" over a run that sent nothing.
      toast({
        title: data?.halted ? "Nothing sent" : "Run complete",
        description: data?.reason ?? undefined,
      });
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

  const previewVars: Record<string, string> = sampleBusiness
    ? {
        ...EXAMPLE_VARS,
        business_name: sampleBusiness.business_name,
        city: sampleBusiness.city,
        owner_name: sampleBusiness.owner_name || "there",
        phone: sampleBusiness.phone || "the number on your listing",
      }
    : EXAMPLE_VARS;

  return (
    <AdminLayout>
      <PageMeta title="Outreach | Admin" description="Outreach email copy, send rate, and results." />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold font-sans">Outreach</h1>
          <HelpTip>
            What the two cold emails say, how many go out per day, and which version performs
            better. Turning outreach on and off is separate — that's the "Send outreach emails"
            switch in Settings → Background Jobs. Nothing on this page sends anything by itself
            except the "Run now" button.
          </HelpTip>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Businesses only receive these once you've switched them on individually in Email Finder.
        </p>

        {loading ? (
          <div className="mt-10 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        ) : (
          <>
            <OutreachReadiness
              result={computeOutreachReadiness({
                deliveryVerifiedAt: deliveryVerifiedAt,
                now: new Date(),
                activeVerifyVariants: variants.filter(
                  (v) => v.email_type === "outreach_verify" && v.is_active,
                ).length,
                activePreviewVariants: variants.filter(
                  (v) => v.email_type === "outreach_preview" && v.is_active,
                ).length,
                eligibleBusinesses: eligibleCount,
                pausedWithEmail,
                needsReview: needsReviewCount,
                cronActive,
                dailyLimit,
                sentToday,
                bccEmail: savedBcc || null,
              })}
            />

            {/* ── Rate ─────────────────────────────────────────────────── */}
            <div className="mt-6 rounded-lg border border-border bg-card p-5">
              <div className="flex items-end gap-3">
                <div>
                  <Label htmlFor="daily-limit" className="flex items-center gap-1.5">
                    Daily send limit
                    <HelpTip>
                      The most outreach emails that will go out in one day, counting both emails
                      together and every run of the job. Set it to 10 and at most 10 are sent that
                      day, however many times the job runs.
                    </HelpTip>
                  </Label>
                  <Input
                    id="daily-limit"
                    type="number"
                    min={1}
                    max={500}
                    className="mt-1 w-28"
                    value={dailyLimit}
                    onChange={(e) => setDailyLimit(Number(e.target.value))}
                    onBlur={(e) => saveDailyLimit(Number(e.target.value))}
                    disabled={savingLimit}
                  />
                </div>
                <Button onClick={runNow} disabled={running} variant="outline">
                  {running ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Running…</>
                  ) : (
                    <><Play className="mr-2 h-4 w-4" aria-hidden="true" />Run now</>
                  )}
                </Button>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Counts both emails together, across every run of the day.
              </p>
              {lastRun && <p className="mt-1 text-xs text-muted-foreground">Last run: {lastRun}</p>}

              <div className="mt-5 border-t border-border pt-4">
                <Label htmlFor="bcc-email" className="flex items-center gap-1.5">
                  Send me a copy (testing)
                  <HelpTip>
                    Blind-copies every outreach email to this address, so you see exactly what each
                    business receives — the real message, not a preview. Leave it empty to turn
                    copies off. It can't be your own sending address: that's the mailbox the
                    inbound bridge watches, so copies would come back in looking like replies.
                  </HelpTip>
                </Label>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Input
                    id="bcc-email"
                    type="email"
                    placeholder="you@example.com — empty to turn off"
                    className="w-72"
                    value={bccEmail}
                    onChange={(e) => setBccEmail(e.target.value)}
                    onBlur={(e) => {
                      if (e.target.value.trim() !== savedBcc) saveBccEmail(e.target.value);
                    }}
                    disabled={savingBcc}
                  />
                  {savedBcc && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={savingBcc}
                      onClick={() => saveBccEmail("")}
                    >
                      Turn off
                    </Button>
                  )}
                </div>

                {savedBcc && (
                  <div className="mt-3 flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 p-3">
                    <Mail className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                    <p className="text-sm">
                      <span className="font-medium">Copies are on.</span> Every outreach email is
                      also going to{" "}
                      <span className="font-mono">{savedBcc}</span>. Turn this off before a full
                      send — it's for testing.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* ── Copy ─────────────────────────────────────────────────── */}
            {STAGES.map((stage) => {
              const stageVariants = variants.filter((v) => v.email_type === stage.key);
              const activeCount = stageVariants.filter((v) => v.is_active).length;

              return (
                <div key={stage.key} className="mt-8">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold font-sans">{stage.label}</h2>
                    {activeCount === 0 ? (
                      <Badge variant="destructive">None active — won't send</Badge>
                    ) : activeCount > 1 ? (
                      <Badge variant="secondary">{activeCount} active — split test</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{stage.blurb}</p>

                  {activeCount === 0 && (
                    <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                      <p className="text-muted-foreground">
                        No active version, so this email is skipped entirely — the job will not fall
                        back to older copy. Switch one on to start sending it again.
                      </p>
                    </div>
                  )}

                  <ul className="mt-4 space-y-4">
                    {stageVariants.map((v) => {
                      const d = draftOf(v);
                      const dirty = Boolean(drafts[v.id]);
                      const stat = stats.find(
                        (s) => s.email_type === v.email_type && s.variant_key === v.variant_key,
                      );
                      const warnLink =
                        stage.key === "outreach_verify" && looksLikeItContainsLink(d.body);

                      return (
                        <li key={v.id} className="rounded-lg border border-border bg-card p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">Version {v.variant_key}</span>
                              {dirty && (
                                <Badge variant="outline" className="text-xs">Unsaved</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2">
                                <Label htmlFor={`w-${v.id}`} className="text-xs text-muted-foreground">
                                  Weight
                                </Label>
                                <Input
                                  id={`w-${v.id}`}
                                  type="number"
                                  min={0}
                                  max={100}
                                  className="w-20"
                                  value={d.weight}
                                  onChange={(e) => edit(v.id, { weight: Number(e.target.value) })}
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                <Label htmlFor={`a-${v.id}`} className="text-xs text-muted-foreground">
                                  {d.is_active ? "Active" : "Off"}
                                </Label>
                                <Switch
                                  id={`a-${v.id}`}
                                  checked={d.is_active}
                                  onCheckedChange={(val) => edit(v.id, { is_active: val })}
                                  aria-label={`Activate version ${v.variant_key}`}
                                />
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 space-y-3">
                            <div>
                              <Label htmlFor={`s-${v.id}`}>Subject</Label>
                              <Input
                                id={`s-${v.id}`}
                                className="mt-1"
                                value={d.subject}
                                onChange={(e) => edit(v.id, { subject: e.target.value })}
                              />
                            </div>
                            <div>
                              <Label htmlFor={`b-${v.id}`}>Message</Label>
                              <Textarea
                                id={`b-${v.id}`}
                                className="mt-1 min-h-[180px] font-mono text-xs"
                                value={d.body}
                                onChange={(e) => edit(v.id, { body: e.target.value })}
                              />
                              <p className="mt-1 text-xs text-muted-foreground">
                                Available fields:{" "}
                                {OUTREACH_MERGE_FIELDS[stage.key]
                                  .map((f) => `{{${f}}}`)
                                  .join(" · ")}
                              </p>
                            </div>
                          </div>

                          {warnLink && (
                            <div className="mt-3 flex items-start gap-2 rounded-md border border-yellow-600/30 bg-yellow-500/5 p-3 text-xs">
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" aria-hidden="true" />
                              <p className="text-muted-foreground">
                                This version looks like it contains a link. Email 1 is deliberately
                                link-free — that's what keeps a cold email out of spam folders. You
                                can still save it; this is only a heads-up.
                              </p>
                            </div>
                          )}

                          <details className="mt-3">
                            <summary className="cursor-pointer text-sm text-accent hover:underline">
                              Preview
                            </summary>
                            <div className="mt-2 rounded-md border border-border bg-background p-3">
                              <p className="text-xs text-muted-foreground">
                                {sampleBusiness
                                  ? `Using ${sampleBusiness.business_name}, a real business currently switched on.`
                                  : "Example data — no business is switched on for outreach yet."}
                              </p>
                              <p className="mt-2 text-sm font-medium">
                                {renderPreview(d.subject, previewVars)}
                              </p>
                              <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-muted-foreground">
                                {renderPreview(d.body, previewVars)}
                              </pre>
                            </div>
                          </details>

                          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                            <p className="text-xs text-muted-foreground">
                              {statsError ? (
                                <span className="text-destructive">Results unavailable</span>
                              ) : stat ? (
                                <>
                                  {stat.sent_count} sent · {stat.replied_count} replied
                                  {stage.key === "outreach_preview" && (
                                    <>
                                      {" "}· {stat.claimed_count} claimed
                                      {stat.sent_count > 0 && (
                                        <> ({Math.round((stat.claimed_count / stat.sent_count) * 100)}%)</>
                                      )}
                                    </>
                                  )}
                                </>
                              ) : (
                                "Not sent yet"
                              )}
                            </p>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                disabled={!dirty || savingId === v.id}
                                onClick={() => save(v)}
                                className="gap-1"
                              >
                                <Save className="h-3.5 w-3.5" aria-hidden="true" />
                                Save
                              </Button>
                              {stageVariants.length > 1 && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1"
                                  onClick={() => removeVariant(v)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                  Remove
                                </Button>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  {stageVariants.length < MAX_VARIANTS_PER_STAGE && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 gap-1"
                      onClick={() => addVariant(stage.key)}
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      Add another version to test
                    </Button>
                  )}
                </div>
              );
            })}

            {statsError && (
              <div className="mt-6 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                <div>
                  <p className="font-medium text-foreground">Couldn't load results</p>
                  <p className="mt-1 font-mono break-all text-muted-foreground">{statsError}</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
