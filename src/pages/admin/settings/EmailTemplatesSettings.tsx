import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Loader2, Save, Eye } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RichTextEditor } from "@/components/admin/RichTextEditor";
import { MOCK_TEMPLATE_DATA } from "@/lib/emailTemplates";

interface EmailTemplatesSettingsProps {
  templates: Record<string, { subject: string; body: string }>;
  setTemplates: (val: Record<string, { subject: string; body: string }> | ((prev: Record<string, { subject: string; body: string }>) => Record<string, { subject: string; body: string }>)) => void;
  addLog: (status: "success" | "error", message: string) => void;
  smtpEnabled: boolean;
  adminNotificationEmail: string;
}

const TIMEOUT_MS = 15_000;

export function EmailTemplatesSettings({
  templates,
  setTemplates,
  addLog,
  smtpEnabled,
  adminNotificationEmail
}: EmailTemplatesSettingsProps) {
  const [selectedTemplateType, setSelectedTemplateType] = useState<string>("new_lead");
  const [savingTemplates, setSavingTemplates] = useState(false);
  const [testingTemplate, setTestingTemplate] = useState(false);

  async function handleSaveTemplates() {
    setSavingTemplates(true);
    try {
      const { error } = await supabase
        .from("admin_settings")
        .upsert(
          { setting_key: "email_templates", setting_value: templates as unknown as Json },
          { onConflict: "setting_key" }
        );
      if (error) throw error;
      toast({ title: "Templates saved" });
      addLog("success", "Email templates saved successfully.");
    } catch (err) {
      const error = err as Error;
      toast({ title: "Error saving templates", description: error.message, variant: "destructive" });
      addLog("error", `Save templates failed: ${error.message}`);
    } finally {
      setSavingTemplates(false);
    }
  }

  async function handleTestTemplate() {
    setTestingTemplate(true);
    addLog("success", `Initiating preview for ${selectedTemplateType}…`);
    try {
      const invokePromise = supabase.functions.invoke("notify-admin-email", {
        body: { 
          notificationType: "test",
          testData: {
            useCustomTemplate: true,
            templateType: selectedTemplateType,
            subject: templates[selectedTemplateType].subject,
            body: templates[selectedTemplateType].body,
            mockData: MOCK_TEMPLATE_DATA[selectedTemplateType]
          }
        },
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
        addLog("error", `Template test failed: ${detailedMessage}`);
        toast({ title: "Test failed", description: detailedMessage, variant: "destructive" });
        return;
      }

      if (data && typeof data === "object" && "error" in data && data.error) {
        addLog("error", `Template test failed: ${data.error}`);
        toast({ title: "Test failed", description: String(data.error), variant: "destructive" });
        return;
      }

      addLog("success", `Preview email dispatched to ${adminNotificationEmail}. Check inbox to view it.`);
      toast({ title: "Preview email dispatched", description: `Check ${adminNotificationEmail} to confirm it arrived.` });
    } catch (err) {
      const error = err as Error;
      addLog("error", `Template test failed: ${error.message}`);
      toast({ title: "Test failed", description: error.message, variant: "destructive" });
    } finally {
      setTestingTemplate(false);
    }
  }

  return (
    <div className="max-w-2xl mt-6 rounded-lg border bg-card p-6">
      <h2 className="text-lg font-semibold mb-1">Email Templates</h2>
      <p className="text-sm text-muted-foreground mb-4">
        The wording of the automated emails. Text in double braces like{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">{"{{full_name}}"}</code> is replaced with
        real values when the email is sent; a token you misspell is replaced with nothing at all, so
        send yourself a test after editing. Leaving a template blank restores the built-in default.
      </p>

      <div className="space-y-4">
        <div>
          <Label className="text-xs text-muted-foreground">Select Template</Label>
          <Select value={selectedTemplateType} onValueChange={setSelectedTemplateType}>
            <SelectTrigger className="w-full sm:w-[300px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new_lead">New Lead Alert</SelectItem>
              <SelectItem value="buyer_notification">Buyer / Provider Notification</SelectItem>
              <SelectItem value="buyer_inquiry">Provider Application Alert</SelectItem>
              <SelectItem value="feedback_submitted">Homeowner Feedback Alert</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {templates && templates[selectedTemplateType] && (
          <>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Subject Line</Label>
              <Input 
                value={templates[selectedTemplateType].subject} 
                onChange={(e) => setTemplates({
                  ...templates,
                  [selectedTemplateType]: { ...templates[selectedTemplateType], subject: e.target.value }
                })} 
                className="font-mono text-xs sm:text-sm"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Body</Label>
              <RichTextEditor 
                content={templates[selectedTemplateType].body} 
                onChange={(html) => setTemplates({
                  ...templates,
                  [selectedTemplateType]: { ...templates[selectedTemplateType], body: html }
                })} 
              />
            </div>
            <div className="rounded-md border bg-muted/30 p-4 text-xs space-y-2">
              <span className="font-semibold text-foreground">Available Variables: </span>
              <span className="text-muted-foreground font-mono">
                {Object.keys(MOCK_TEMPLATE_DATA[selectedTemplateType] || {}).map(k => `{{${k}}}`).join(", ")}
              </span>
              <p className="text-muted-foreground mt-2">
                Variables are replaced with real data before sending. Safe HTML tags like &lt;b&gt;, &lt;a&gt;, and &lt;br&gt; are supported.
              </p>
            </div>
          </>
        )}

        <div className="flex gap-3 pt-4 border-t">
          <Button onClick={handleSaveTemplates} disabled={savingTemplates} className="gap-2">
            {savingTemplates ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Templates
          </Button>
          <Button variant="outline" onClick={handleTestTemplate} disabled={testingTemplate || !smtpEnabled} className="gap-2">
            {testingTemplate ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
            Send Test Preview
          </Button>
        </div>
      </div>
    </div>
  );
}
