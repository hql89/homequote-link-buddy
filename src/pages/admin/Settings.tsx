import { useState, useEffect, useRef } from "react";
import { PageMeta } from "@/components/PageMeta";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DEFAULT_EMAIL_TEMPLATES } from "@/lib/emailTemplates";
import { AccountSettings } from "./settings/AccountSettings";
import { AnalyticsSettings } from "./settings/AnalyticsSettings";
import { BackgroundJobsSettings } from "./settings/BackgroundJobsSettings";
import { SmtpConfig, SMTPSettings } from "./settings/SMTPSettings";
import { EmailTemplatesSettings } from "./settings/EmailTemplatesSettings";
import { ResponseLog, LogEntry } from "./settings/ResponseLog";

const DEFAULT_CONFIG: SmtpConfig = {
  smtpHost: "",
  smtpPort: 587,
  smtpUsername: "",
  smtpPassword: "",
  fromEmail: "",
  fromName: "Valley Home Pros",
  adminNotificationEmail: "",
  enabled: true,
};

export default function SettingsPage() {
  const { user } = useAuth();
  const [config, setConfig] = useState<SmtpConfig>(DEFAULT_CONFIG);
  const [templates, setTemplates] = useState<Record<string, { subject: string; body: string }>>(DEFAULT_EMAIL_TEMPLATES);
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsOpen, setLogsOpen] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);

  function addLog(status: "success" | "error", message: string) {
    setLogs((prev) => [
      ...prev,
      { timestamp: new Date().toLocaleTimeString(), status, message },
    ]);
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  useEffect(() => {
    async function load() {
      const [smtpResult, templateData] = await Promise.all([
        supabase.from("admin_settings").select("setting_value").eq("setting_key", "smtp_config").maybeSingle(),
        supabase.from("admin_settings").select("setting_value").eq("setting_key", "email_templates").maybeSingle(),
      ]);

      if (!smtpResult.error && smtpResult.data?.setting_value) {
        setConfig({ ...DEFAULT_CONFIG, ...(smtpResult.data.setting_value as unknown as SmtpConfig) });
      }
      if (!templateData.error && templateData.data?.setting_value) {
        setTemplates({ ...DEFAULT_EMAIL_TEMPLATES, ...(templateData.data.setting_value as unknown as Record<string, { subject: string; body: string }>) });
      }
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      </AdminLayout>
    );
  }

  return (
    <>
      <PageMeta title="Settings | Valley Home Pros Admin" description="Admin settings." />
      <AdminLayout>
        <h1 className="text-2xl font-bold mb-6 font-sans">Settings</h1>

        <AccountSettings userEmail={user?.email} />

        <AnalyticsSettings />

        <BackgroundJobsSettings />

        <SMTPSettings
          config={config}
          setConfig={setConfig}
          addLog={addLog}
        />

        <EmailTemplatesSettings
          templates={templates}
          setTemplates={setTemplates}
          addLog={addLog}
          smtpEnabled={config.enabled}
          adminNotificationEmail={config.adminNotificationEmail}
        />

        <ResponseLog
          logs={logs}
          logsOpen={logsOpen}
          setLogsOpen={setLogsOpen}
          logEndRef={logEndRef}
        />
      </AdminLayout>
    </>
  );
}
