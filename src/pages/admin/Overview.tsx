import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageMeta } from "@/components/PageMeta";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { KpiCard } from "@/components/admin/analytics/KpiCard";
import { OutreachReadiness } from "@/components/admin/OutreachReadiness";
import { computeOutreachReadiness } from "@/lib/outreachReadiness";
import { resolveRange, mergeActivity, type ActivityEvent, type RangePreset } from "@/lib/overviewMetrics";
import { supabase } from "@/integrations/supabase/client";
import { directoryDb } from "@/integrations/supabase/directory";
import {
  Loader2, Building2, MailCheck, MessageSquareReply, BadgeCheck, FileText,
  XCircle, ArrowRight, Search, Send, DownloadCloud, Activity as ActivityIcon,
} from "lucide-react";

const RANGES: { key: RangePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
];

interface Metrics {
  businessesTotal: number;
  published: number;
  verifiedEmail: number;
  needsReview: number;
  eligible: number;
  pausedWithEmail: number;
  outreachSent: number;
  outreachSentPrev: number;
  replies: number;
  repliesPrev: number;
  claims: number;
  claimsPrev: number;
  leads: number;
  leadsPrev: number;
  jobFailures: number;
  jobFailuresPrev: number;
  enrichedInRange: number;
}

/** Everything the readiness panel needs, gathered alongside the metrics. */
interface OutreachState {
  deliveryVerifiedAt: string | null;
  dailyLimit: number;
  bccEmail: string | null;
  sentToday: number;
  activeVerify: number;
  activePreview: number;
  cronActive: boolean | null;
}

const ISO = (d: Date) => d.toISOString();

export default function OverviewPage() {
  const [range, setRange] = useState<RangePreset>("7d");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [outreach, setOutreach] = useState<OutreachState | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const w = resolveRange(range);
    const count = (q: { count: number | null }) => q.count ?? 0;

    try {
      const [
        total, published, verified, needsReview, eligible, pausedWithEmail,
        sent, sentPrev, replies, repliesPrev, claims, claimsPrev,
        leads, leadsPrev, enriched,
        cfgRes, variantsRes, sentTodayRes, cronRes, runsRes,
        recentSends, recentReplies, recentClaims, recentLeads,
      ] = await Promise.all([
        directoryDb.from("businesses").select("id", { count: "exact", head: true }),
        directoryDb.from("businesses").select("id", { count: "exact", head: true }).eq("is_published", true),
        directoryDb.from("businesses").select("id", { count: "exact", head: true }).eq("email_confidence", "verified").not("email", "is", null),
        directoryDb.from("businesses").select("id", { count: "exact", head: true }).eq("email_confidence", "needs_review"),
        directoryDb.from("businesses").select("id", { count: "exact", head: true })
          .eq("email_confidence", "verified").eq("outreach_paused", false)
          .is("outreach_suppressed_at", null).is("email_undeliverable_at", null)
          .is("outreach_email_1_sent_at", null).not("email", "is", null),
        directoryDb.from("businesses").select("id", { count: "exact", head: true })
          .eq("email_confidence", "verified").eq("outreach_paused", true).not("email", "is", null),

        supabase.from("outreach_sends").select("id", { count: "exact", head: true }).gte("sent_at", ISO(w.since)),
        supabase.from("outreach_sends").select("id", { count: "exact", head: true }).gte("sent_at", ISO(w.prevSince)).lt("sent_at", ISO(w.prevUntil)),
        supabase.from("inbound_emails").select("id", { count: "exact", head: true }).gte("received_at", ISO(w.since)),
        supabase.from("inbound_emails").select("id", { count: "exact", head: true }).gte("received_at", ISO(w.prevSince)).lt("received_at", ISO(w.prevUntil)),
        directoryDb.from("businesses").select("id", { count: "exact", head: true }).eq("is_claimed", true).gte("claimed_at", ISO(w.since)),
        directoryDb.from("businesses").select("id", { count: "exact", head: true }).eq("is_claimed", true).gte("claimed_at", ISO(w.prevSince)).lt("claimed_at", ISO(w.prevUntil)),
        supabase.from("leads").select("id", { count: "exact", head: true }).gte("created_at", ISO(w.since)),
        supabase.from("leads").select("id", { count: "exact", head: true }).gte("created_at", ISO(w.prevSince)).lt("created_at", ISO(w.prevUntil)),
        directoryDb.from("businesses").select("id", { count: "exact", head: true }).gte("enriched_at", ISO(w.since)),

        supabase.from("admin_settings").select("setting_value").eq("setting_key", "outreach_config").maybeSingle(),
        supabase.from("outreach_template_variants").select("email_type, is_active").eq("is_active", true),
        supabase.from("outreach_sends").select("id", { count: "exact", head: true })
          .gte("sent_at", new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())).toISOString()),
        supabase.rpc("admin_list_cron_jobs"),
        supabase.rpc("admin_recent_job_runs", { p_limit: 25 }),

        supabase.from("outreach_sends").select("id, sent_at, email_type").order("sent_at", { ascending: false }).limit(6),
        supabase.from("inbound_emails").select("id, received_at, from_email, classification").order("received_at", { ascending: false }).limit(6),
        directoryDb.from("businesses").select("id, business_name, claimed_at").eq("is_claimed", true).not("claimed_at", "is", null).order("claimed_at", { ascending: false }).limit(6),
        supabase.from("leads").select("id, created_at, city, service_type").order("created_at", { ascending: false }).limit(6),
      ]);

      const cfg = (cfgRes.data?.setting_value ?? {}) as { daily_limit?: number; bcc_email?: string; delivery_verified_at?: string };
      const variants = (variantsRes.data ?? []) as { email_type: string; is_active: boolean }[];
      const cronJobs = cronRes.error ? null : ((cronRes.data ?? []) as { jobname: string; active: boolean }[]);
      const runs = (runsRes.data ?? []) as { job_name: string; status: string; created_at: string; error_message: string | null }[];

      setMetrics({
        businessesTotal: count(total), published: count(published), verifiedEmail: count(verified),
        needsReview: count(needsReview), eligible: count(eligible), pausedWithEmail: count(pausedWithEmail),
        outreachSent: count(sent), outreachSentPrev: count(sentPrev),
        replies: count(replies), repliesPrev: count(repliesPrev),
        claims: count(claims), claimsPrev: count(claimsPrev),
        leads: count(leads), leadsPrev: count(leadsPrev),
        jobFailures: runs.filter((r) => r.status === "failure" && r.created_at >= ISO(w.since)).length,
        jobFailuresPrev: runs.filter((r) => r.status === "failure" && r.created_at >= ISO(w.prevSince) && r.created_at < ISO(w.prevUntil)).length,
        enrichedInRange: count(enriched),
      });

      setOutreach({
        deliveryVerifiedAt: cfg.delivery_verified_at ?? null,
        dailyLimit: Number.isFinite(cfg.daily_limit) ? Number(cfg.daily_limit) : 10,
        bccEmail: cfg.bcc_email ?? null,
        sentToday: count(sentTodayRes),
        activeVerify: variants.filter((v) => v.email_type === "outreach_verify").length,
        activePreview: variants.filter((v) => v.email_type === "outreach_preview").length,
        cronActive: cronJobs === null ? null : (cronJobs.find((j) => j.jobname === "send-outreach-drip-daily")?.active ?? false),
      });

      setActivity(mergeActivity([
        ((recentSends.data ?? []) as { id: string; sent_at: string; email_type: string }[]).map((r) => ({
          id: `s-${r.id}`, at: r.sent_at, kind: "outreach" as const, href: "/admin/outreach/sent",
          text: r.email_type === "outreach_verify" ? "Sent a verification email" : "Sent a listing-preview email",
        })),
        ((recentReplies.data ?? []) as { id: string; received_at: string; from_email: string; classification: string }[]).map((r) => ({
          id: `r-${r.id}`, at: r.received_at, kind: "reply" as const, href: "/admin/replies",
          text: `Reply from ${r.from_email}${r.classification === "unsubscribe" ? " — asked to stop" : ""}`,
        })),
        ((recentClaims.data ?? []) as { id: string; business_name: string; claimed_at: string }[]).map((r) => ({
          id: `c-${r.id}`, at: r.claimed_at, kind: "claim" as const,
          text: `${r.business_name} claimed their listing`,
        })),
        ((recentLeads.data ?? []) as { id: string; created_at: string; city: string | null; service_type: string | null }[]).map((r) => ({
          id: `l-${r.id}`, at: r.created_at, kind: "lead" as const, href: `/admin/leads`,
          text: `New lead${r.service_type ? ` — ${r.service_type}` : ""}${r.city ? ` in ${r.city}` : ""}`,
        })),
      ]));
    } catch (err) {
      // An overview that renders zeroes when its own queries failed is worse
      // than one that renders nothing: every card would read as a real,
      // measured "0" for a business that might be doing fine.
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const w = resolveRange(range);

  return (
    <AdminLayout>
      <PageMeta title="Overview | Admin" description="Operational overview." />
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold font-sans">Overview</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              What needs attention, and what's changed over {w.label}.
            </p>
          </div>
          <div className="flex gap-1 rounded-md border border-border p-1">
            {RANGES.map((r) => (
              <Button
                key={r.key}
                size="sm"
                variant={range === r.key ? "default" : "ghost"}
                className="h-7 px-3 text-xs"
                onClick={() => setRange(r.key)}
              >
                {r.label}
              </Button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="mt-10 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        ) : loadError ? (
          <Alert variant="destructive" className="mt-6">
            <XCircle className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>Couldn't load the overview</AlertTitle>
            <AlertDescription className="font-mono text-xs">{loadError}</AlertDescription>
          </Alert>
        ) : metrics && outreach ? (
          <>
            {/* ── Needs attention, above the numbers ─────────────────── */}
            <OutreachReadiness
              result={computeOutreachReadiness({
                deliveryVerifiedAt: outreach.deliveryVerifiedAt,
                now: new Date(),
                activeVerifyVariants: outreach.activeVerify,
                activePreviewVariants: outreach.activePreview,
                eligibleBusinesses: metrics.eligible,
                pausedWithEmail: metrics.pausedWithEmail,
                needsReview: metrics.needsReview,
                cronActive: outreach.cronActive,
                dailyLimit: outreach.dailyLimit,
                sentToday: outreach.sentToday,
                bccEmail: outreach.bccEmail,
              })}
            />

            {metrics.needsReview > 0 && (
              <Alert className="mt-4 border-yellow-600/40 bg-yellow-500/5">
                <Search className="h-4 w-4 text-yellow-600" aria-hidden="true" />
                <AlertTitle className="flex items-center justify-between gap-4">
                  <span>{metrics.needsReview} waiting for review</span>
                  <Link to="/admin/enrichment" className="text-sm font-normal text-accent hover:underline">
                    Review now
                  </Link>
                </AlertTitle>
                <AlertDescription className="text-sm text-muted-foreground">
                  An email was found but couldn't be automatically matched to the business.
                </AlertDescription>
              </Alert>
            )}

            {/* ── Metrics ────────────────────────────────────────────── */}
            <h2 className="mt-8 text-lg font-semibold font-sans">Activity over {w.label}</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard icon={MailCheck} label="Outreach emails sent" value={String(metrics.outreachSent)}
                currentValue={metrics.outreachSent} previousValue={metrics.outreachSentPrev} href="/admin/outreach/sent" />
              <KpiCard icon={MessageSquareReply} label="Replies received" value={String(metrics.replies)}
                currentValue={metrics.replies} previousValue={metrics.repliesPrev} href="/admin/replies" />
              <KpiCard icon={BadgeCheck} label="Listings claimed" value={String(metrics.claims)}
                currentValue={metrics.claims} previousValue={metrics.claimsPrev} />
              <KpiCard icon={FileText} label="New leads" value={String(metrics.leads)}
                currentValue={metrics.leads} previousValue={metrics.leadsPrev} href="/admin/leads" />
            </div>

            <h2 className="mt-8 text-lg font-semibold font-sans">Directory</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard icon={Building2} label="Businesses listed" value={String(metrics.businessesTotal)} />
              <KpiCard icon={Building2} label="Published" value={String(metrics.published)} />
              <KpiCard icon={MailCheck} label="With a verified email" value={String(metrics.verifiedEmail)} href="/admin/enrichment" />
              <KpiCard icon={Search} label={`Emails found in ${w.label}`} value={String(metrics.enrichedInRange)} href="/admin/enrichment" />
            </div>

            {/* ── Activity feed + quick actions ──────────────────────── */}
            <div className="mt-8 grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <h2 className="text-lg font-semibold font-sans">Recent activity</h2>
                {activity.length === 0 ? (
                  <Card className="mt-3">
                    <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
                      <ActivityIcon className="h-8 w-8" aria-hidden="true" />
                      <p className="text-sm">Nothing has happened yet.</p>
                      <p className="text-xs">Sends, replies, claims and new leads will appear here.</p>
                    </CardContent>
                  </Card>
                ) : (
                  <Card className="mt-3">
                    <CardContent className="divide-y divide-border p-0">
                      {activity.map((e) => (
                        <div key={e.id} className="flex items-start justify-between gap-3 px-4 py-3">
                          <div className="min-w-0">
                            <p className="text-sm text-foreground">{e.text}</p>
                            <p className="text-xs text-muted-foreground">{new Date(e.at).toLocaleString()}</p>
                          </div>
                          {e.href && (
                            <Link to={e.href} className="shrink-0 text-xs text-accent hover:underline">
                              Open
                            </Link>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>

              <div>
                <h2 className="text-lg font-semibold font-sans">Quick actions</h2>
                <Card className="mt-3">
                  <CardContent className="space-y-1 p-2">
                    {/* Links, never one-click triggers: the actions behind these
                        screens send real email to real businesses, and each
                        carries its own confirmation for good reason. */}
                    {[
                      { to: "/admin/enrichment", icon: Search, label: "Find & review emails" },
                      { to: "/admin/outreach", icon: Send, label: "Outreach copy & sending" },
                      { to: "/admin/ingest", icon: DownloadCloud, label: "Import businesses" },
                      { to: "/admin/replies", icon: MessageSquareReply, label: "Read replies" },
                      { to: "/admin/system", icon: ActivityIcon, label: "System status" },
                    ].map((a) => (
                      <Link
                        key={a.to}
                        to={a.to}
                        className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted"
                      >
                        <a.icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="flex-1">{a.label}</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                      </Link>
                    ))}
                  </CardContent>
                </Card>

                {metrics.jobFailures > 0 && (
                  <Alert variant="destructive" className="mt-3">
                    <XCircle className="h-4 w-4" aria-hidden="true" />
                    <AlertTitle>{metrics.jobFailures} background job failures</AlertTitle>
                    <AlertDescription className="text-sm">
                      <Link to="/admin/settings#recent-runs" className="underline">Check recent runs</Link>
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </AdminLayout>
  );
}
