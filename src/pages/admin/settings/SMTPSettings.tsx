import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Loader2, Eye, EyeOff, Save, SendHorizonal, CheckCircle2 } from "lucide-react";

export interface SmtpConfig {
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpPassword: string;
  fromEmail: string;
  fromName: string;
  adminNotificationEmail: string;
  enabled: boolean;
}

interface SMTPSettingsProps {
  config: SmtpConfig;
  setConfig: (val: SmtpConfig | ((prev: SmtpConfig) => SmtpConfig)) => void;
  addLog: (status: "success" | "error", message: string) => void;
}

const TIMEOUT_MS = 15_000;

export function SMTPSettings({ config, setConfig, addLog }: SMTPSettingsProps) {
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Set once a test has been dispatched, so "I received it" only appears when
  // there is actually something to have received.
  const [testDispatched, setTestDispatched] = useState(false);
  const [confirming, setConfirming] = useState(false);

  function updateField<K extends keyof SmtpConfig>(key: K, value: SmtpConfig[K]) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  /**
   * Records that a human saw the test email land.
   *
   * send-outreach-drip reads this and refuses to send without a recent one.
   * It is deliberately a separate, manual step from sending the test: the
   * send succeeding proves only that SMTP accepted the message.
   */
  async function handleConfirmDelivery() {
    setConfirming(true);
    try {
      const { data: existing } = await supabase
        .from("admin_settings")
        .select("setting_value")
        .eq("setting_key", "outreach_config")
        .maybeSingle();

      const merged = {
        ...((existing?.setting_value as Record<string, unknown>) ?? {}),
        delivery_verified_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("admin_settings")
        .upsert({ setting_key: "outreach_config", setting_value: merged }, { onConflict: "setting_key" });

      if (error) throw error;

      setTestDispatched(false);
      addLog("success", "Delivery confirmed — outreach may send for the next 14 days.");
      toast({
        title: "Delivery confirmed",
        description: "Outreach emails can send again. This expires in 14 days.",
      });
    } catch (err) {
      const error = err as Error;
      addLog("error", `Could not record delivery confirmation: ${error.message}`);
      toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
    } finally {
      setConfirming(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("admin_settings")
        .upsert(
          { setting_key: "smtp_config", setting_value: config as unknown as Json },
          { onConflict: "setting_key" }
        );
      if (error) throw error;
      toast({ title: "Settings saved" });
      addLog("success", "Settings saved successfully.");
    } catch (err) {
      const error = err as Error;
      toast({ title: "Error saving", description: error.message, variant: "destructive" });
      addLog("error", `Save failed: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    addLog("success", "Initiating test email…");
    try {
      // Save first so the edge function reads latest config
      const { error: saveErr } = await supabase
        .from("admin_settings")
        .upsert(
          { setting_key: "smtp_config", setting_value: config as unknown as Json },
          { onConflict: "setting_key" }
        );
      if (saveErr) {
        addLog("error", `Failed to save config before test: ${saveErr.message}`);
        return;
      }

      const invokePromise = supabase.functions.invoke("notify-admin-email", {
        body: { notificationType: "test" },
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Request timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS)
      );

      const { data, error } = await Promise.race([invokePromise, timeoutPromise]);

      if (error) {
        let detailedMessage = error.message || "Unknown error";
        try {
          if ("context" in error && (error as { context: unknown }).context instanceof Response) {
            const body = await (error as { context: Response }).context.json();
            if (body?.error) detailedMessage = body.error;
          }
        } catch {
          // Fallback to error message
        }
        addLog("error", `Test failed: ${detailedMessage}`);
        toast({ title: "Test failed", description: detailedMessage, variant: "destructive" });
        return;
      }

      if (data && typeof data === "object" && "error" in data && data.error) {
        addLog("error", `Test failed: ${data.error}`);
        toast({ title: "Test failed", description: String(data.error), variant: "destructive" });
        return;
      }

      setTestDispatched(true);
      addLog("success", `Test email dispatched to ${config.adminNotificationEmail}. Check inbox to confirm delivery.`);
      toast({ title: "Test email dispatched", description: `Check ${config.adminNotificationEmail} to confirm it arrived.` });
    } catch (err) {
      const error = err as Error;
      addLog("error", `Test failed: ${error.message}`);
      toast({ title: "Test failed", description: error.message, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="max-w-2xl rounded-lg border bg-card p-6">
      <h2 className="text-lg font-semibold mb-1">Email Notifications (SMTP)</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Configure your SMTP server to enable outbound email notifications. The system sends the following email types:
      </p>

      <div className="rounded-md border bg-muted/30 p-4 mb-6 text-sm space-y-3">
        <div>
          <span className="font-semibold text-foreground">1. New Lead Alert</span>
          <span className="text-muted-foreground"> — Sent to the Admin Notification Email immediately when a homeowner submits a lead form. Includes full lead details, urgency badge, and a CRM link.</span>
        </div>
        <div>
          <span className="font-semibold text-foreground">2. Buyer / Provider Notification</span>
          <span className="text-muted-foreground"> — Sent to the assigned buyer's email when a lead is routed to them. Contains customer name, phone, service type, and description (no internal IDs or CRM links).</span>
        </div>
        <div>
          <span className="font-semibold text-foreground">3. Provider Application Alert</span>
          <span className="text-muted-foreground"> — Sent to the Admin Notification Email when a new provider submits an application to join the network. Includes business info, service areas, and their message.</span>
        </div>
        <div>
          <span className="font-semibold text-foreground">4. Lead Nurture Emails</span>
          <span className="text-muted-foreground"> — Automated follow-up emails sent to homeowners. A follow-up is scheduled 48 hours after submission, and a feedback request at 120 hours (5 days). Processed in batches by a scheduled function.</span>
        </div>
        <div>
          <span className="font-semibold text-foreground">5. Homeowner Lead Confirmation</span>
          <span className="text-muted-foreground"> — Sent to the homeowner's email after they submit a lead, confirming receipt and outlining next steps. Triggered manually from the admin CRM.</span>
        </div>
        <div>
          <span className="font-semibold text-foreground">6. Test Email</span>
          <span className="text-muted-foreground"> — Sent to the Admin Notification Email via the "Send Test Email" button below to verify SMTP configuration is working.</span>
        </div>
      </div>

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="text-xs text-muted-foreground">SMTP Host</Label>
            <Input value={config.smtpHost} onChange={(e) => updateField("smtpHost", e.target.value)} placeholder="smtp.example.com" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">SMTP Port</Label>
            <Input type="number" value={config.smtpPort} onChange={(e) => updateField("smtpPort", parseInt(e.target.value) || 587)} />
            {[993, 995].includes(config.smtpPort) && (
              <p className="text-xs text-destructive mt-1">
                Port {config.smtpPort} is for receiving email (IMAP/POP3). Use 465 (SSL) or 587 (STARTTLS) for sending.
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="text-xs text-muted-foreground">SMTP Username</Label>
            <Input value={config.smtpUsername} onChange={(e) => updateField("smtpUsername", e.target.value)} placeholder="user@example.com" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">SMTP Password</Label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                value={config.smtpPassword}
                onChange={(e) => updateField("smtpPassword", e.target.value)}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full px-3"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="text-xs text-muted-foreground">From Email</Label>
            <Input value={config.fromEmail} onChange={(e) => updateField("fromEmail", e.target.value)} placeholder="notifications@homequotelink.com" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">From Name</Label>
            <Input value={config.fromName} onChange={(e) => updateField("fromName", e.target.value)} placeholder="Valley Home Pros" />
          </div>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Admin Notification Email</Label>
          <Input value={config.adminNotificationEmail} onChange={(e) => updateField("adminNotificationEmail", e.target.value)} placeholder="admin@homequotelink.com" />
        </div>

        <div className="flex items-center justify-between pt-2">
          <Label>Enabled</Label>
          <Switch checked={config.enabled} onCheckedChange={(v) => updateField("enabled", v)} />
        </div>

        <div className="flex gap-3 pt-4 border-t">
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Settings
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={testing} className="gap-2">
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
            Send Test Email
          </Button>
        </div>

        {/*
          The outreach drip refuses to send without this. "Dispatched" only
          means the mail server accepted the message — on 2026-08-01 it
          accepted every one and discarded them all. Only a human who saw the
          email arrive can confirm delivery, so only a human can clear this.
        */}
        {testDispatched && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
            <p className="text-sm font-medium">Did the test email actually arrive?</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Check {config.adminNotificationEmail} — including spam. A message being accepted by the
              mail server does not mean it was delivered. Outreach emails stay switched off until
              this is confirmed, and the confirmation expires after 14 days.
            </p>
            <Button
              size="sm"
              className="mt-3 gap-2"
              disabled={confirming}
              onClick={handleConfirmDelivery}
            >
              {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Yes, it arrived
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
