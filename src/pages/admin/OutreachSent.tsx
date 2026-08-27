import { useState, useEffect, useCallback } from "react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { PageMeta } from "@/components/PageMeta";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { HelpTip } from "@/components/admin/HelpTip";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { directoryDb, formatPhoneDisplay, type EmailSendLogRow } from "@/integrations/supabase/directory";
import { renderPreview } from "@/lib/outreachCopy";
import { Loader2, Mail, ChevronDown, ChevronUp, AlertTriangle, XCircle } from "lucide-react";

const PAGE_SIZE = 50;

/**
 * Typed as `string`, not a literal, on purpose.
 *
 * postgrest-js infers the result shape by parsing the select string at the
 * type level. The `->>` JSON accessors make that parse deep enough to trip
 * TS2589 ("excessively deep"), which poisons inference for the whole file.
 * Widening to `string` opts out of the parse; the query sent is identical
 * and the row shape is asserted at the call site.
 *
 * Reading the named keys rather than the whole `setting_value` blob is a
 * deliberate boundary: the stored SMTP password must never reach the
 * browser. Keep the `->>` accessors.
 */
const SENDER_NAME_SELECT: string = "from_name:setting_value->>fromName";

const EMAIL_TYPE_LABEL: Record<string, string> = {
  outreach_verify: "Email 1 — verification",
  outreach_preview: "Email 2 — preview",
};

interface BusinessInfo {
  business_name: string;
  city: string;
}

interface Row extends EmailSendLogRow {
  business: BusinessInfo | null;
  variant_key: string | null;
}

/**
 * The body shown when a row is expanded.
 *
 * "real" means `row.body` — the exact text the send actually used, stored
 * since 20260821010000. "reconstructed" only ever applies to rows sent
 * before that migration, where no real body was ever captured and this is
 * the best available approximation, re-rendered from the current template
 * and the business's current info.
 */
interface DisplayBody {
  state: "loading" | "ready" | "unavailable";
  source?: "real" | "reconstructed";
  text?: string;
}

export default function OutreachSentPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [bodies, setBodies] = useState<Record<string, DisplayBody>>({});

  const loadPage = useCallback(async (offset: number) => {
    // Fetch one extra row to know whether another page exists, without a
    // separate count query.
    const { data, error } = await directoryDb
      .from("email_send_log")
      .select("id, sent_at, job_name, email_type, recipient_email, recipient_kind, subject, body, related_business_id, related_lead_id, status, method, error_message, bounced_at, bounce_kind")
      .in("email_type", ["outreach_verify", "outreach_preview"])
      .eq("recipient_kind", "business")
      .order("sent_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE);

    if (error) return { rows: [] as Row[], error, more: false };

    const all = (data ?? []) as EmailSendLogRow[];
    const more = all.length > PAGE_SIZE;
    const pageRows = all.slice(0, PAGE_SIZE);

    const businessIds = [
      ...new Set(pageRows.map((r) => r.related_business_id).filter((id): id is string => !!id)),
    ];

    const businessMap = new Map<string, BusinessInfo>();
    const variantMap = new Map<string, string>();

    if (businessIds.length > 0) {
      const [bizRes, sendRes] = await Promise.all([
        directoryDb.from("businesses").select("id, business_name, city").in("id", businessIds),
        // outreach_sends is the only record of which A/B version actually
        // went out — email_send_log only knows the rendered subject, not
        // which variant produced it.
        supabase.from("outreach_sends").select("business_id, email_type, variant_key").in("business_id", businessIds),
      ]);
      for (const b of (bizRes.data ?? []) as { id: string; business_name: string; city: string }[]) {
        businessMap.set(b.id, { business_name: b.business_name, city: b.city });
      }
      for (const s of (sendRes.data ?? []) as { business_id: string; email_type: string; variant_key: string }[]) {
        variantMap.set(`${s.business_id}:${s.email_type}`, s.variant_key);
      }
    }

    const rowsOut: Row[] = pageRows.map((r) => ({
      ...r,
      business: r.related_business_id ? businessMap.get(r.related_business_id) ?? null : null,
      variant_key: r.related_business_id ? variantMap.get(`${r.related_business_id}:${r.email_type}`) ?? null : null,
    }));

    return { rows: rowsOut, error: null, more };
  }, []);

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { rows: pageRows, error, more } = await loadPage(0);
    if (error) {
      setLoadError(error.message);
    } else {
      setRows(pageRows);
      setHasMore(more);
    }
    setLoading(false);
  }, [loadPage]);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  async function loadMore() {
    setLoadingMore(true);
    const { rows: pageRows, error, more } = await loadPage(rows.length);
    if (error) {
      toast({ title: "Couldn't load more", description: error.message, variant: "destructive" });
    } else {
      setRows((prev) => [...prev, ...pageRows]);
      setHasMore(more);
    }
    setLoadingMore(false);
  }

  async function toggleRow(row: Row) {
    if (expanded === row.id) {
      setExpanded(null);
      return;
    }
    setExpanded(row.id);
    if (bodies[row.id]) return; // already fetched

    // The common case now: the real body was stored at send time, so there is
    // nothing to reconstruct and nothing to fetch. Reconstruction below is
    // reached only by rows sent before 20260821010000, when body was null.
    if (row.body) {
      setBodies((prev) => ({ ...prev, [row.id]: { state: "ready", source: "real", text: row.body! } }));
      return;
    }

    if (!row.related_business_id) {
      setBodies((prev) => ({ ...prev, [row.id]: { state: "unavailable" } }));
      return;
    }

    setBodies((prev) => ({ ...prev, [row.id]: { state: "loading" } }));

    const [variantRes, bizRes, senderRes] = await Promise.all([
      directoryDb
        .from("outreach_template_variants")
        .select("body")
        .eq("email_type", row.email_type as "outreach_verify" | "outreach_preview")
        .eq("variant_key", row.variant_key ?? "A")
        .maybeSingle(),
      // Extra columns beyond AdminBusinessRow (owner_name, claim_token) — the
      // base client, not directoryDb, matches the pattern already used for
      // this on the Outreach template-preview page.
      supabase
        .from("businesses")
        .select("business_name, city, owner_name, phone, slug, city_slug, claim_token")
        .eq("id", row.related_business_id)
        .maybeSingle(),
      supabase.from("admin_settings").select(SENDER_NAME_SELECT).eq("setting_key", "smtp_config").maybeSingle(),
    ]);

    const biz = bizRes.data as {
      business_name: string;
      city: string;
      owner_name: string | null;
      phone: string | null;
      slug: string;
      city_slug: string;
      claim_token: string;
    } | null;
    const body = (variantRes.data as { body: string } | null)?.body;
    const senderName = (senderRes.data as unknown as { from_name: string | null } | null)?.from_name || "The Directory Team";

    if (!body || !biz) {
      setBodies((prev) => ({ ...prev, [row.id]: { state: "unavailable" } }));
      return;
    }

    const siteUrl = window.location.origin;
    const vars: Record<string, string> = {
      business_name: biz.business_name,
      city: biz.city,
      owner_name: biz.owner_name || "there",
      phone: biz.phone ? formatPhoneDisplay(biz.phone) : "",
      sender_name: senderName,
      ...(row.email_type === "outreach_preview"
        ? { claim_url: `${siteUrl}/directory/${biz.city_slug}/${biz.slug}/claim?token=${biz.claim_token}` }
        : {}),
    };

    setBodies((prev) => ({
      ...prev,
      [row.id]: { state: "ready", source: "reconstructed", text: renderPreview(body, vars) },
    }));
  }

  return (
    <AdminLayout>
      <PageMeta title="Sent Emails | Admin" description="Every outreach email actually sent, most recent first." />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold font-sans">Sent Emails</h1>
          <HelpTip>
            Every outreach email the send job has actually delivered (or tried to), most recent
            first. Both the subject and the body shown are the exact text that was sent. Rows
            from before 2026-08-21 didn't have their body saved — for those only, opening the
            row reconstructs an approximation from the current template and that business's
            current info, which can drift from what was really sent.
          </HelpTip>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Read-only log. To change what these emails say, use{" "}
          <a href="/admin/outreach" className="text-accent hover:underline">Outreach copy &amp; sending</a>.
        </p>

        {loading ? (
          <div className="mt-10 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        ) : loadError ? (
          <Alert variant="destructive" className="mt-6">
            <XCircle className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>Couldn't load sent emails</AlertTitle>
            <AlertDescription className="font-mono text-xs">{loadError}</AlertDescription>
          </Alert>
        ) : rows.length === 0 ? (
          <div className="mt-10 flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <Mail className="h-8 w-8" aria-hidden="true" />
            <p className="text-sm">No outreach emails sent yet.</p>
          </div>
        ) : (
          <>
            <ul className="mt-6 space-y-3">
              {rows.map((row) => {
                const isOpen = expanded === row.id;
                const body = bodies[row.id];
                return (
                  <li key={row.id} className="rounded-lg border border-border bg-card p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{EMAIL_TYPE_LABEL[row.email_type] ?? row.email_type}</Badge>
                      {row.variant_key && <Badge variant="outline">Version {row.variant_key}</Badge>}
                      <Badge variant={row.status === "sent" ? "secondary" : "destructive"}>
                        {row.status === "sent" ? "Sent" : "Failed"}
                      </Badge>
                      {row.business ? (
                        <span className="text-sm font-medium">
                          {`${row.business.business_name} — ${row.business.city}`}
                        </span>
                      ) : (
                        <Badge variant="outline">No matching business</Badge>
                      )}
                      <span className="ml-auto text-xs text-muted-foreground">
                        {new Date(row.sent_at).toLocaleString()}
                      </span>
                    </div>

                    <p className="mt-2 text-xs text-muted-foreground">To: {row.recipient_email}</p>
                    {row.subject && <p className="mt-1 text-sm font-medium">{row.subject}</p>}

                    {row.status !== "sent" && row.error_message && (
                      <div className="mt-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />
                        <p className="text-muted-foreground">{row.error_message}</p>
                      </div>
                    )}

                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-2 gap-1"
                      onClick={() => toggleRow(row)}
                    >
                      {isOpen ? (
                        <><ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />Hide body</>
                      ) : (
                        <><ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />View body</>
                      )}
                    </Button>

                    {isOpen && (
                      <div className="mt-2 rounded-md border border-border bg-background p-3">
                        {!body || body.state === "loading" ? (
                          <div className="flex justify-center py-4">
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
                          </div>
                        ) : body.state === "unavailable" ? (
                          <p className="text-sm text-muted-foreground">
                            Can't reconstruct this one — the business or template it used is gone.
                          </p>
                        ) : (
                          <>
                            {body.source === "reconstructed" && (
                              <div className="flex items-start gap-2 rounded-md border border-yellow-600/30 bg-yellow-500/5 p-2 text-xs">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-yellow-600" aria-hidden="true" />
                                <p className="text-muted-foreground">
                                  Sent before bodies were saved (2026-08-21), so this is reconstructed from
                                  the current template and this business's current info — not a saved copy.
                                  The subject above is the real one that was sent; this body may differ if
                                  the template or the business's details changed since.
                                </p>
                              </div>
                            )}
                            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-muted-foreground">
                              {body.text}
                            </pre>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            {hasMore && (
              <div className="mt-6 flex justify-center">
                <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Loading…</>
                  ) : (
                    "Load more"
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
