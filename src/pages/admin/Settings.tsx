import { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { PageMeta } from "@/components/PageMeta";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DEFAULT_EMAIL_TEMPLATES } from "@/lib/emailTemplates";
import { AccountSettings } from "./settings/AccountSettings";
import { AnalyticsSettings } from "./settings/AnalyticsSettings";
import { BackgroundJobsSettings } from "./settings/BackgroundJobsSettings";
import { PerplexitySettings } from "./settings/PerplexitySettings";
import { SmtpConfig, SMTPSettings } from "./settings/SMTPSettings";
import { EmailTemplatesSettings } from "./settings/EmailTemplatesSettings";
import { ResponseLog, LogEntry } from "./settings/ResponseLog";

const DEFAULT_CONFIG: SmtpConfig = {
  smtpHost: "",
  smtpPort: 587,
  smtpUsername: "",
  fromEmail: "",
  fromName: "Valley Home Pros",
  adminNotificationEmail: "",
  enabled: true,
};

export default function SettingsPage() {
  const { user } = useAuth();
  const location = useLocation();
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
        // Drop `smtpPassword` before it reaches React state. The password now
        // lives in Supabase Vault, but this row can still carry the old
        // plaintext key until the drop-plaintext migration has run — and a
        // credential that is merely *scheduled* for removal is still a
        // credential sitting in the browser. Strip it here rather than relying
        // on the column being gone.
        const { smtpPassword: _discarded, ...safe } =
          smtpResult.data.setting_value as unknown as SmtpConfig & { smtpPassword?: string };
        setConfig({ ...DEFAULT_CONFIG, ...safe });
      }
      if (!templateData.error && templateData.data?.setting_value) {
        setTemplates({ ...DEFAULT_EMAIL_TEMPLATES, ...(templateData.data.setting_value as unknown as Record<string, { subject: string; body: string }>) });
      }
      setLoading(false);
    }
    load();
  }, []);

  // BrowserRouter doesn't scroll to a URL hash on client-side navigation
  // (that's a data-router-only feature via ScrollRestoration), so a link
  // like "/admin/settings#recent-runs" would otherwise land at the top of
  // this long page. Do it ourselves once the section has actually mounted.
  useEffect(() => {
    if (loading || !location.hash) return;
    const id = location.hash.slice(1);
    const target = document.getElementById(id);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [loading, location.hash]);

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

        <PerplexitySettings />

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
