import { useParams, useNavigate } from "react-router-dom";
import { useLead, useUpdateLead } from "@/hooks/useLeads";
import { useBuyers } from "@/hooks/useBuyers";
import { useLeadEvents, useInsertLeadEvent } from "@/hooks/useLeadEvents";
import { useAuth } from "@/hooks/useAuth";
import { PageMeta } from "@/components/PageMeta";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  LeadInfoCard,
  TrackingDataCard,
  NotesCard,
  NurtureEmailsCard,
  LeadFeedbackCard,
  ActivityCard,
  ManagementCard,
  AIQualityCard,
  SpamControlsCard,
  FlagsCard,
  LeadMetadataCard
} from "./leads/LeadDetailSections";

const DESTRUCTIVE_STATUSES = ["archived", "refunded", "rejected", "spam"];

export default function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: lead, isLoading } = useLead(id);
  const { data: buyers } = useBuyers();
  const { data: events } = useLeadEvents(id);
  const updateLead = useUpdateLead();
  const insertEvent = useInsertLeadEvent();
  const [noteText, setNoteText] = useState("");
  const [reviewReason, setReviewReason] = useState("");
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [sendingBuyerNotif, setSendingBuyerNotif] = useState(false);
  const [analyzingLead, setAnalyzingLead] = useState(false);
  const [markingSpam, setMarkingSpam] = useState(false);
  const [sendingNurture, setSendingNurture] = useState(false);

  // Fetch nurture emails for this lead
  const { data: nurtureEmails } = useQuery({
    queryKey: ["nurture_emails", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_nurture_emails")
        .select("*")
        .eq("lead_id", id!)
        .order("scheduled_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  // Fetch feedback for this lead
  const { data: leadFeedback } = useQuery({
    queryKey: ["lead_feedback", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_feedback")
        .select("*")
        .eq("lead_id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Derive buyer notification sent state from events
  const buyerNotifEvent = useMemo(() => {
    if (!events) return null;
    return events.find((e) => e.event_type === "buyer_notification_sent") || null;
  }, [events]);

  const buyerChangedSinceNotif = useMemo(() => {
    if (!buyerNotifEvent || !lead) return false;
    try {
      const detail = JSON.parse(buyerNotifEvent.event_detail || "{}");
      return detail.buyer_id !== lead.assigned_buyer_id;
    } catch {
      return false;
    }
  }, [buyerNotifEvent, lead]);

  useEffect(() => {
    if (lead) setReviewReason(lead.review_reason || "");
  }, [lead, setReviewReason]);

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      </AdminLayout>
    );
  }

  if (!lead) {
    return (
      <AdminLayout>
        <p className="py-20 text-center text-muted-foreground">Lead not found.</p>
      </AdminLayout>
    );
  }

  async function handleUpdate(field: string, value: unknown) {
    try {
      await updateLead.mutateAsync({ id: lead!.id, [field]: value } as import("@/types").LeadUpdate & { id: string });
      await insertEvent.mutateAsync({
        lead_id: lead!.id,
        event_type: "field_update",
        event_detail: `${field} changed to ${value}`,
        created_by_user_id: user?.id,
      });
      toast({ title: "Updated" });
    } catch (error: unknown) {
      if (error instanceof Error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    }
  }

  function handleStatusChange(newStatus: string) {
    if (DESTRUCTIVE_STATUSES.includes(newStatus)) {
      setPendingStatus(newStatus);
    } else {
      handleUpdate("status", newStatus);
    }
  }

  async function handleAddNote() {
    if (!noteText.trim()) return;
    try {
      await updateLead.mutateAsync({ id: lead!.id, notes: (lead!.notes ? lead!.notes + "\n" : "") + noteText });
      await insertEvent.mutateAsync({
        lead_id: lead!.id,
        event_type: "note_added",
        event_detail: noteText,
        created_by_user_id: user?.id,
      });
      setNoteText("");
      toast({ title: "Note added" });
    } catch (error: unknown) {
      if (error instanceof Error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    }
  }

  async function handleSendBuyerNotification() {
    setSendingBuyerNotif(true);
    try {
      const { error } = await supabase.functions.invoke("send-buyer-notification", {
        body: { leadId: lead!.id },
      });
      if (error) {
        let msg = error.message || "Unknown error";
        try {
          const errCtx = error as { context?: unknown };
          if (errCtx.context instanceof Response) {
            const body = await errCtx.context.json() as { error?: string };
            if (body?.error) msg = body.error;
          }
        } catch (e) {
          console.warn("Could not parse error response", e);
        }
        throw new Error(msg);
      }

      const assignedBuyer = buyers?.find((b) => b.id === lead!.assigned_buyer_id);
      await insertEvent.mutateAsync({
        lead_id: lead!.id,
        event_type: "buyer_notification_sent",
        event_detail: JSON.stringify({
          buyer_id: lead!.assigned_buyer_id,
          buyer_email: assignedBuyer?.email,
          timestamp: new Date().toISOString(),
        }),
        created_by_user_id: user?.id,
      });

      toast({ title: "Notification sent", description: `Email dispatched to ${assignedBuyer?.email || "buyer"}. Verify delivery in their inbox.` });

      // Trigger nurture sequence if lead has email
      if (lead!.email) {
        setSendingNurture(true);
        try {
          await supabase.functions.invoke("send-lead-confirmation", {
            body: { leadId: lead!.id, siteUrl: window.location.origin },
          });
          queryClient.invalidateQueries({ queryKey: ["nurture_emails", lead!.id] });
          queryClient.invalidateQueries({ queryKey: ["lead_feedback", lead!.id] });
          toast({ title: "Nurture sequence started", description: "Confirmation email sent to lead. Follow-up and feedback emails scheduled." });
        } catch (nurtureErr: unknown) {
          if (nurtureErr instanceof Error) {
            toast({ title: "Nurture failed", description: nurtureErr.message, variant: "destructive" });
          }
        } finally {
          setSendingNurture(false);
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        toast({ title: "Failed to send", description: err.message || "Please try again", variant: "destructive" });
      }
    } finally {
      setSendingBuyerNotif(false);
    }
  }

  async function handleAnalyzeLead() {
    setAnalyzingLead(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-lead", {
        body: { leadId: lead!.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (typeof data?.score !== "number") throw new Error("No score returned from analysis");
      toast({ title: "AI Analysis Complete", description: `Score: ${data.score} — ${data.reason}` });
      // Refetch lead data
      queryClient.invalidateQueries({ queryKey: ["lead", lead!.id] });
    } catch (err: unknown) {
      if (err instanceof Error) {
        toast({ title: "Analysis failed", description: err.message || "Please try again", variant: "destructive" });
      }
    } finally {
      setAnalyzingLead(false);
    }
  }

  async function handleMarkSpam() {
    setMarkingSpam(true);
    try {
      // Update status to spam
      await updateLead.mutateAsync({ id: lead!.id, status: "spam", spam_flag: true });

      // Add to blocklists
      if (lead!.email_normalized) {
        await supabase.from("blocked_emails").upsert(
          { email_normalized: lead!.email_normalized, source_lead_id: lead!.id },
          { onConflict: "email_normalized" }
        );
      }
      if (lead!.phone_normalized) {
        await supabase.from("blocked_phones").upsert(
          { phone_normalized: lead!.phone_normalized, source_lead_id: lead!.id },
          { onConflict: "phone_normalized" }
        );
      }

      await insertEvent.mutateAsync({
        lead_id: lead!.id,
        event_type: "marked_spam",
        event_detail: `Email: ${lead!.email_normalized || "n/a"}, Phone: ${lead!.phone_normalized || "n/a"} added to blocklist`,
        created_by_user_id: user?.id,
      });

      queryClient.invalidateQueries({ queryKey: ["lead", lead!.id] });
      toast({ title: "Marked as spam", description: "Contact has been blocklisted." });
    } catch (err: unknown) {
      if (err instanceof Error) {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    } finally {
      setMarkingSpam(false);
    }
  }

  return (
    <>
      <PageMeta title={`Lead: ${lead.full_name} | Admin`} description="Lead detail view." />
      <AdminLayout>
        <Button variant="ghost" onClick={() => navigate("/admin")} className="mb-4 gap-2">
          <ArrowLeft className="h-4 w-4" /> Back to Leads
        </Button>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main info */}
          <div className="lg:col-span-2 space-y-6">
            <LeadInfoCard lead={lead} />
            <TrackingDataCard lead={lead} />
            <NotesCard
              lead={lead}
              noteText={noteText}
              setNoteText={setNoteText}
              onAddNote={handleAddNote}
            />
            <NurtureEmailsCard nurtureEmails={nurtureEmails || []} />
            <LeadFeedbackCard leadFeedback={leadFeedback} />
            <ActivityCard events={events || []} />
          </div>

          {/* Sidebar controls */}
          <div className="space-y-6">
            <ManagementCard
              lead={lead}
              buyers={buyers}
              onStatusChange={handleStatusChange}
              onUpdateField={handleUpdate}
              onSendNotification={handleSendBuyerNotification}
              sendingNotif={sendingBuyerNotif}
              buyerNotifEvent={buyerNotifEvent}
              buyerChangedSinceNotif={buyerChangedSinceNotif}
              reviewReason={reviewReason}
              setReviewReason={setReviewReason}
            />
            <AIQualityCard
              lead={lead}
              analyzingLead={analyzingLead}
              onAnalyze={handleAnalyzeLead}
            />
            <SpamControlsCard
              lead={lead}
              markingSpam={markingSpam}
              onMarkSpam={handleMarkSpam}
            />
            <FlagsCard lead={lead} onUpdateField={handleUpdate} />
            <LeadMetadataCard lead={lead} />
          </div>
        </div>

        {/* Destructive status confirmation dialog */}
        <AlertDialog open={!!pendingStatus} onOpenChange={(open) => { if (!open) setPendingStatus(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Change status to "{pendingStatus}"?</AlertDialogTitle>
              <AlertDialogDescription>
                This is a destructive status change. Are you sure you want to mark this lead as <strong>{pendingStatus}</strong>?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => { if (pendingStatus) { handleUpdate("status", pendingStatus); setPendingStatus(null); } }}>
                Confirm
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </AdminLayout>
    </>
  );
}
