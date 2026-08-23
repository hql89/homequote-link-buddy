import { useState, useEffect, useCallback } from "react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { PageMeta } from "@/components/PageMeta";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { HelpTip } from "@/components/admin/HelpTip";
import { Input } from "@/components/ui/input";
import {
  directoryDb,
  markReplyHandled,
  setBusinessSuppressed,
  applyReplyWebsiteUrl,
  listIgnoredSenders,
  addIgnoredSender,
  removeIgnoredSender,
  type InboundEmailRow,
  type IgnoredSenderRow,
} from "@/integrations/supabase/directory";
import { Loader2, Mail, AlertCircle, Check, Ban, Link2, ShieldOff, EyeOff, X } from "lucide-react";

interface BusinessInfo {
  business_name: string;
  city: string;
  outreach_suppressed_at: string | null;
}

interface ReplyRow extends InboundEmailRow {
  business: BusinessInfo | null;
}

/**
 * Every value the database's classification CHECK allows must have an entry.
 * This is a Record keyed on the union, so a missing value does not fail to
 * compile — it renders an EMPTY badge, which is how the `bounce` rows sat
 * here unlabelled until 2026-08-23.
 */
const CLASSIFICATION_LABEL: Record<InboundEmailRow["classification"], string> = {
  unsubscribe: "Unsubscribed",
  confirm: "Confirmed phone",
  website: "Sent a website",
  unclassified: "Other",
  bounce: "Delivery failed",
  self_sent: "Sent by us",
  ignored: "Ignored sender",
};

/** The domain half of an address, used to offer a domain-wide ignore rule. */
function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase();
}

/** Rows per page when viewing "All" — this table has no cap otherwise. */
const REPLIES_PAGE_SIZE = 100;

export default function RepliesPage() {
  const [replies, setReplies] = useState<ReplyRow[]>([]);
  const [suppressed, setSuppressed] = useState<(BusinessInfo & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** "unhandled" is the default work queue; "all" is the archive — replies
   *  you've already dealt with stop being reachable once "Mark handled" is
   *  clicked, otherwise, which breaks any link (like Overview's Recent
   *  Activity "Open") pointing at a reply that's since been handled.
   *  "ignored" is the third: mail from a sender marked as noise. It is a
   *  separate view rather than a hidden state precisely so that "ignored"
   *  never means "gone" — every ignored message stays one click away. */
  const [view, setView] = useState<"unhandled" | "all" | "ignored">("unhandled");
  const [ignoredSenders, setIgnoredSenders] = useState<IgnoredSenderRow[]>([]);
  /** id of the reply whose inline "ignore which?" choices are open. */
  const [ignoringId, setIgnoringId] = useState<string | null>(null);
  const [newPattern, setNewPattern] = useState("");

  const load = useCallback(async () => {
    setLoading(true);

    let repliesQuery = directoryDb.from("inbound_emails").select("*");
    if (view === "ignored") {
      repliesQuery = repliesQuery.eq("classification", "ignored");
    } else {
      // Ignored mail is excluded from BOTH working views. Excluding it from
      // "all" too is deliberate: the point of the feature is that vendor
      // noise stops competing for attention with real replies, and an
      // archive drowning in login codes fails that just as badly as a queue
      // drowning in them. The "ignored" tab is where it lives.
      repliesQuery = repliesQuery.neq("classification", "ignored");
      if (view === "unhandled") {
        repliesQuery = repliesQuery.is("handled_at", null);
      }
    }
    repliesQuery =
      view === "unhandled"
        ? // Priority first (a real question), then oldest-first within each
          // group — a sort hint for attention, never an automated action.
          repliesQuery.order("is_priority", { ascending: false }).order("received_at", { ascending: true })
        : repliesQuery.order("received_at", { ascending: false }).limit(REPLIES_PAGE_SIZE);

    const [repliesRes, suppressedRes, ignoredRes] = await Promise.all([
      repliesQuery,
      directoryDb
        .from("businesses")
        .select("id, business_name, city, outreach_suppressed_at")
        .not("outreach_suppressed_at", "is", null),
      listIgnoredSenders(),
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

    // A failed read of the rules is surfaced, never rendered as "no rules" —
    // an empty list and an unreadable list look identical on screen and mean
    // opposite things.
    if (ignoredRes.error) {
      toast({
        title: "Couldn't load ignored senders",
        description: ignoredRes.error.message,
        variant: "destructive",
      });
    }
    setIgnoredSenders(ignoredRes.rows);

    setReplies(rows.map((r) => ({ ...r, business: r.business_id ? businessMap.get(r.business_id) ?? null : null })));
    setSuppressed(
      ((suppressedRes.data ?? []) as { id: string; business_name: string; city: string; outreach_suppressed_at: string | null }[]).map(
        (b) => ({ id: b.id, business_name: b.business_name, city: b.city, outreach_suppressed_at: b.outreach_suppressed_at }),
      ),
    );
    setLoading(false);
  }, [view]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleMarkHandled(id: string) {
    setBusyId(id);
    const error = await markReplyHandled(id);
    if (error) {
      toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
    } else if (view === "unhandled") {
      // The unhandled queue drops it entirely — that's the point of the view.
      setReplies((prev) => prev.filter((r) => r.id !== id));
    } else {
      // The "All" archive keeps showing it, now marked handled.
      setReplies((prev) => prev.map((r) => (r.id === id ? { ...r, handled_at: new Date().toISOString() } : r)));
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

  /**
   * Marks a sender as noise and re-files their past messages.
   *
   * Every check that makes this safe lives in the database function, not
   * here: a pattern matching a real business is refused, and so is a public
   * mail provider like gmail.com. The button reports what the server decided
   * rather than second-guessing it, so the two can never disagree.
   */
  async function handleIgnore(reply: ReplyRow, matchType: "address" | "domain") {
    const pattern = matchType === "domain" ? domainOf(reply.from_email) : reply.from_email;
    setBusyId(reply.id);
    const { swept, error } = await addIgnoredSender(matchType, pattern, reply.subject ?? undefined);
    if (error) {
      toast({ title: "Couldn't ignore that sender", description: error.message, variant: "destructive" });
      setBusyId(null);
      return;
    }
    toast({
      title: `Ignoring ${pattern}`,
      description:
        swept === 1
          ? "1 past message moved to Ignored. Nothing was deleted."
          : `${swept} past messages moved to Ignored. Nothing was deleted.`,
    });
    setIgnoringId(null);
    setBusyId(null);
    await load();
  }

  /** Manual entry, for an exact address you'd rather not wait to receive again. */
  async function handleAddPattern() {
    const raw = newPattern.trim();
    if (!raw) return;
    // An entry containing "@" is one mailbox; anything else is a domain.
    const matchType = raw.includes("@") && !raw.startsWith("@") ? "address" : "domain";
    setBusyId("new-pattern");
    const { swept, error } = await addIgnoredSender(matchType, raw);
    if (error) {
      toast({ title: "Couldn't add that", description: error.message, variant: "destructive" });
      setBusyId(null);
      return;
    }
    toast({ title: "Sender ignored", description: `${swept} past messages moved to Ignored.` });
    setNewPattern("");
    setBusyId(null);
    await load();
  }

  async function handleRemovePattern(id: string) {
    setBusyId(id);
    const error = await removeIgnoredSender(id);
    if (error) {
      toast({ title: "Couldn't remove", description: error.message, variant: "destructive" });
    } else {
      toast({
        title: "Rule removed",
        description: "New mail from that sender will show up again. Messages already ignored stay in the Ignored tab.",
      });
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
          {view === "unhandled" && replies.length > 0 && (
            <Badge variant="secondary">{replies.length} unhandled</Badge>
          )}
          <HelpTip>
            Every reply to an outreach email lands here, classified automatically by matching
            against phrases like "yes" and "stop" — never by a model guessing. A reply saying
            STOP already suppressed that business the moment it arrived; nothing here waits on
            you for that. What does wait on you: applying a website URL someone sent, and
            reading anything that didn't match a known pattern.
          </HelpTip>
          <div className="ml-auto flex gap-1 rounded-md border border-border p-1">
            {(["unhandled", "all", "ignored"] as const).map((v) => (
              <Button
                key={v}
                size="sm"
                variant={view === v ? "default" : "ghost"}
                className="h-7 px-3 text-xs capitalize"
                onClick={() => setView(v)}
              >
                {v}
              </Button>
            ))}
          </div>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {view === "ignored"
            ? "Mail from senders you've marked as noise. Nothing here was deleted — it's kept out of the queue, not thrown away."
            : "Nothing here ever sends a reply automatically — every action is a click you make."}
          {view !== "unhandled" && ` Showing the most recent ${REPLIES_PAGE_SIZE}, newest first.`}
          {/* "All" excludes ignored mail, so it must say so. A tab labelled
              All that quietly hides a category is the same failure as an
              error state rendered as an empty list. */}
          {view === "all" && ignoredSenders.length > 0 && " Mail from ignored senders is under Ignored."}
        </p>

        {loading ? (
          <div className="mt-10 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        ) : replies.length === 0 ? (
          <div className="mt-10 flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <Mail className="h-8 w-8" aria-hidden="true" />
            <p className="text-sm">
              {view === "unhandled"
                ? "No unhandled replies."
                : view === "ignored"
                  ? "No ignored mail yet. Use \u201cIgnore sender\u201d on anything that isn\u2019t a reply."
                  : "No replies yet."}
            </p>
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {replies.map((reply) => (
              <li key={reply.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={reply.classification === "unsubscribe" ? "destructive" : "secondary"}>
                    {CLASSIFICATION_LABEL[reply.classification]}
                  </Badge>
                  {reply.handled_at && (
                    <Badge variant="outline" className="gap-1">
                      <Check className="h-3 w-3" aria-hidden="true" />
                      Handled
                    </Badge>
                  )}
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
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(reply.received_at).toLocaleString()}
                  </span>
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

                {!reply.handled_at && (
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
                  {ignoringId === reply.id ? (
                    <>
                      <span className="self-center text-xs text-muted-foreground">Ignore:</span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === reply.id}
                        onClick={() => handleIgnore(reply, "address")}
                      >
                        {`Just ${reply.from_email}`}
                      </Button>
                      {domainOf(reply.from_email) && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === reply.id}
                          onClick={() => handleIgnore(reply, "domain")}
                        >
                          {`Everything from ${domainOf(reply.from_email)}`}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setIgnoringId(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      disabled={busyId === reply.id}
                      onClick={() => setIgnoringId(reply.id)}
                    >
                      <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                      Ignore sender
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
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Always rendered, unlike the suppressed-businesses list below it:
            this section is also the only place to ADD a rule by hand, so
            hiding it when empty would hide the control that fills it. */}
        <div className="mt-10">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <EyeOff className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Ignored senders
            {ignoredSenders.length > 0 && <Badge variant="secondary">{ignoredSenders.length}</Badge>}
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Mail from these senders skips the queue and is filed under Ignored. It is still saved —
            nothing is deleted. A domain covers its subdomains. You cannot ignore an address
            belonging to a business in your directory, or a public provider like gmail.com.
          </p>

          <div className="mt-3 flex gap-2">
            <Input
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              placeholder="vercel.com or someone@example.com"
              aria-label="Address or domain to ignore"
              className="max-w-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddPattern();
              }}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!newPattern.trim() || busyId === "new-pattern"}
              onClick={handleAddPattern}
            >
              {busyId === "new-pattern" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                "Ignore"
              )}
            </Button>
          </div>

          {ignoredSenders.length > 0 && (
            <ul className="mt-3 space-y-2">
              {ignoredSenders.map((rule) => (
                <li
                  key={rule.id}
                  className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <Badge variant="outline" className="capitalize">
                      {rule.match_type}
                    </Badge>
                    <span className="font-mono text-xs">{rule.pattern}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1"
                    disabled={busyId === rule.id}
                    onClick={() => handleRemovePattern(rule.id)}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

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
