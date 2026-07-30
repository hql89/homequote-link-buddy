import { useState, useEffect, useCallback } from "react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { PageMeta } from "@/components/PageMeta";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { HelpTip } from "@/components/admin/HelpTip";
import {
  directoryDb,
  markReplyHandled,
  setBusinessSuppressed,
  applyReplyWebsiteUrl,
  type InboundEmailRow,
} from "@/integrations/supabase/directory";
import { Loader2, Mail, AlertCircle, Check, Ban, Link2, ShieldOff } from "lucide-react";

interface BusinessInfo {
  business_name: string;
  city: string;
  outreach_suppressed_at: string | null;
}

interface ReplyRow extends InboundEmailRow {
  business: BusinessInfo | null;
}

const CLASSIFICATION_LABEL: Record<InboundEmailRow["classification"], string> = {
  unsubscribe: "Unsubscribed",
  confirm: "Confirmed phone",
  website: "Sent a website",
  unclassified: "Other",
};

export default function RepliesPage() {
  const [replies, setReplies] = useState<ReplyRow[]>([]);
  const [suppressed, setSuppressed] = useState<(BusinessInfo & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    const [repliesRes, suppressedRes] = await Promise.all([
      directoryDb
        .from("inbound_emails")
        .select("*")
        .is("handled_at", null)
        // Priority first (a real question), then oldest-first within each
        // group — a sort hint for attention, never an automated action.
        .order("is_priority", { ascending: false })
        .order("received_at", { ascending: true }),
      directoryDb
        .from("businesses")
        .select("id, business_name, city, outreach_suppressed_at")
        .not("outreach_suppressed_at", "is", null),
    ]);

    if (repliesRes.error) {
      toast({ title: "Couldn't load replies", description: repliesRes.error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const rows = (repliesRes.data ?? []) as InboundEmailRow[];
    const businessIds = [...new Set(rows.map((r) => r.business_id).filter((id): id is string => !!id))];

    const businessMap = new Map<string, BusinessInfo>();
    if (businessIds.length > 0) {
      const { data: bizRows } = await directoryDb
        .from("businesses")
        .select("id, business_name, city, outreach_suppressed_at")
        .in("id", businessIds);
      for (const b of (bizRows ?? []) as { id: string; business_name: string; city: string; outreach_suppressed_at: string | null }[]) {
        businessMap.set(b.id, { business_name: b.business_name, city: b.city, outreach_suppressed_at: b.outreach_suppressed_at });
      }
    }

    setReplies(rows.map((r) => ({ ...r, business: r.business_id ? businessMap.get(r.business_id) ?? null : null })));
    setSuppressed(
      ((suppressedRes.data ?? []) as { id: string; business_name: string; city: string; outreach_suppressed_at: string | null }[]).map(
        (b) => ({ id: b.id, business_name: b.business_name, city: b.city, outreach_suppressed_at: b.outreach_suppressed_at }),
      ),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleMarkHandled(id: string) {
    setBusyId(id);
    const error = await markReplyHandled(id);
    if (error) {
      toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
    } else {
      setReplies((prev) => prev.filter((r) => r.id !== id));
    }
    setBusyId(null);
  }

  async function handleSuppress(reply: ReplyRow) {
    if (!reply.business_id) return;
    setBusyId(reply.id);
    const error = await setBusinessSuppressed(reply.business_id, true);
    if (error) {
      toast({ title: "Couldn't suppress", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Business suppressed", description: "Excluded from all future outreach." });
      await load();
    }
    setBusyId(null);
  }

  async function handleUnsuppress(businessId: string) {
    setBusyId(businessId);
    const error = await setBusinessSuppressed(businessId, false);
    if (error) {
      toast({ title: "Couldn't un-suppress", description: error.message, variant: "destructive" });
    } else {
      await load();
    }
    setBusyId(null);
  }

  async function handleApplyUrl(reply: ReplyRow) {
    if (!reply.business_id || !reply.extracted_url) return;
    setBusyId(reply.id);
    const error = await applyReplyWebsiteUrl(reply.business_id, reply.extracted_url);
    if (error) {
      toast({ title: "Couldn't apply URL", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Website added to listing" });
      await handleMarkHandled(reply.id);
      return;
    }
    setBusyId(null);
  }

  return (
    <AdminLayout>
      <PageMeta title="Replies | Admin" description="Replies to outreach emails." />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold font-sans">Replies</h1>
          {replies.length > 0 && <Badge variant="secondary">{replies.length} unhandled</Badge>}
          <HelpTip>
            Every reply to an outreach email lands here, classified automatically by matching
            against phrases like "yes" and "stop" — never by a model guessing. A reply saying
            STOP already suppressed that business the moment it arrived; nothing here waits on
            you for that. What does wait on you: applying a website URL someone sent, and
            reading anything that didn't match a known pattern.
          </HelpTip>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Nothing here ever sends a reply automatically — every action is a click you make.
        </p>

        {loading ? (
          <div className="mt-10 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        ) : replies.length === 0 ? (
          <div className="mt-10 flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <Mail className="h-8 w-8" aria-hidden="true" />
            <p className="text-sm">No unhandled replies.</p>
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {replies.map((reply) => (
              <li key={reply.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={reply.classification === "unsubscribe" ? "destructive" : "secondary"}>
                    {CLASSIFICATION_LABEL[reply.classification]}
                  </Badge>
                  {reply.is_priority && (
                    <Badge variant="outline" className="gap-1 border-amber-400 text-amber-700">
                      <AlertCircle className="h-3 w-3" aria-hidden="true" />
                      Looks like a question
                    </Badge>
                  )}
                  {reply.business ? (
                    <span className="text-sm font-medium">
                      {`${reply.business.business_name} — ${reply.business.city}`}
                    </span>
                  ) : (
                    <Badge variant="outline">No matching business</Badge>
                  )}
                </div>

                <p className="mt-2 text-xs text-muted-foreground">
                  {reply.from_name ? `${reply.from_name} <${reply.from_email}>` : reply.from_email}
                  {reply.subject && ` — ${reply.subject}`}
                </p>

                {reply.body_text && (
                  <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-line rounded bg-muted/40 p-2 text-sm">
                    {reply.body_text}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {reply.classification === "website" && reply.extracted_url && reply.business_id && (
                    <Button
                      size="sm"
                      className="gap-1"
                      disabled={busyId === reply.id}
                      onClick={() => handleApplyUrl(reply)}
                    >
                      <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Apply {reply.extracted_url}
                    </Button>
                  )}
                  {reply.business_id && !reply.business?.outreach_suppressed_at && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      disabled={busyId === reply.id}
                      onClick={() => handleSuppress(reply)}
                    >
                      <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                      Suppress
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1"
                    disabled={busyId === reply.id}
                    onClick={() => handleMarkHandled(reply.id)}
                  >
                    {busyId === reply.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    Mark handled
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {suppressed.length > 0 && (
          <div className="mt-10">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <ShieldOff className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Suppressed businesses
              <Badge variant="secondary">{suppressed.length}</Badge>
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Permanently excluded from outreach, independent of the enabled/paused settings.
            </p>
            <ul className="mt-3 space-y-2">
              {suppressed.map((b) => (
                <li key={b.id} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
                  <span>{`${b.business_name} — ${b.city}`}</span>
                  <Button size="sm" variant="ghost" disabled={busyId === b.id} onClick={() => handleUnsuppress(b.id)}>
                    Un-suppress
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
