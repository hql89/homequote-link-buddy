import { serviceRoleKey as readServiceRoleKey } from "../_shared/supabaseKeys.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { logEmailSend } from "../_shared/emailLog.ts";
import { isSelfAddressed, checkVolumeCircuitBreaker } from "../_shared/mailer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SMTP_TIMEOUT_MS = 10_000;
const IMAP_PORTS = [993, 995];

/* ── HTML helpers ─────────────────────────────────────────────── */

function htmlWrapper(title: string, innerHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0;">
<tr><td align="center">
<!-- Header -->
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
<tr><td style="background:#2563eb;padding:20px 28px;border-radius:12px 12px 0 0;">
<span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">HomeQuoteLink</span>
</td></tr>
<!-- Body card -->
<tr><td style="background:#ffffff;padding:28px;border-radius:0 0 12px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
${innerHtml}
</td></tr>
</table>
<!-- Footer -->
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;margin-top:16px;">
<tr><td style="text-align:center;color:#999;font-size:12px;padding:8px;">
© ${new Date().getFullYear()} HomeQuoteLink &middot; ${new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PT
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function row(label: string, value: string): string {
  return `<tr>
<td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#777;font-size:13px;width:140px;vertical-align:top;">${label}</td>
<td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-size:14px;font-weight:500;">${value}</td>
</tr>`;
}

function badge(text: string, bg: string, fg = "#fff"): string {
  return `<span style="display:inline-block;padding:3px 10px;border-radius:20px;background:${bg};color:${fg};font-size:12px;font-weight:600;">${text}</span>`;
}

function ctaButton(text: string, href: string): string {
  return `<table cellpadding="0" cellspacing="0" style="margin:24px 0 8px;">
<tr><td style="background:#f97316;border-radius:8px;">
<a href="${href}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">${text}</a>
</td></tr></table>`;
}

function sectionTitle(text: string): string {
  return `<h2 style="margin:20px 0 8px;font-size:15px;font-weight:700;color:#2563eb;border-bottom:2px solid #2563eb;padding-bottom:6px;display:inline-block;">${text}</h2>`;
}

/* ── Vertical label helper ─────────────────────────────────────── */

const VERTICAL_LABELS: Record<string, string> = {
  plumbing: "Plumbing",
  hvac: "HVAC / AC",
  landscaping: "Yard & Landscaping",
  electrical: "Electrical",
};

function verticalLabel(key: string): string {
  return VERTICAL_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1);
}

/* ── Dynamic Template Fallbacks ────────────────────────────────── */

const DEFAULT_TEMPLATES: Record<string, { subject: string; body: string }> = {
  new_lead: {
    subject: "New Lead — {{urgency}} — {{full_name}} in {{city}}",
    body: `
<h1 style="margin:0 0 4px;font-size:18px;font-weight:700;">New Lead Received</h1>
<p style="margin:0 0 16px;color:#666;font-size:13px;">Urgency: <strong>{{urgency}}</strong></p>

<table width="100%" cellpadding="0" cellspacing="0">
  ${row("Name", "{{full_name}}")}
  ${row("Phone", '<a href="tel:{{phone}}" style="color:#2563eb;text-decoration:none;">{{phone}}</a>')}
  ${row("Email", '<a href="mailto:{{email}}" style="color:#2563eb;text-decoration:none;">{{email}}</a>')}
  ${row("City", "{{city}}")}
  ${row("ZIP", "{{zip_code}}")}
  ${row("Service", "{{service_type}}")}
  ${row("Urgency", "{{urgency}}")}
  ${row("Contact Pref", "{{preferred_contact_method}}")}
</table>

${sectionTitle("Description")}
<p style="margin:8px 0;font-size:14px;line-height:1.5;color:#333;">{{description}}</p>

${ctaButton("View in CRM →", "https://homequotelink.com/admin/leads/{{id}}")}
    `.trim()
  },
  buyer_notification: {
    subject: "New {{vertical}} Lead — {{service_type}} in {{city}}",
    body: `
<h1 style="margin:0 0 4px;font-size:18px;font-weight:700;">New Lead for You</h1>
<p style="margin:0 0 16px;color:#666;font-size:14px;">Hi {{buyerContactName}}, you have a new {{vertical}} lead.</p>

<table width="100%" cellpadding="0" cellspacing="0">
  ${row("Customer", "{{full_name}}")}
  ${row("Phone", '<a href="tel:{{phone}}" style="color:#2563eb;text-decoration:none;font-weight:600;">{{phone}}</a>')}
  ${row("Email", '<a href="mailto:{{email}}" style="color:#2563eb;text-decoration:none;">{{email}}</a>')}
  ${row("City", "{{city}}")}
  ${row("Service", "{{service_type}}")}
  ${row("Urgency", "{{urgency}}")}
</table>

${sectionTitle("Customer's Description")}
<p style="margin:8px 0;font-size:14px;line-height:1.5;color:#333;background:#f9fafb;padding:12px 16px;border-radius:8px;border-left:3px solid #2563eb;">"{{description}}"</p>

${ctaButton("Call {{full_name}} →", "tel:{{phone}}")}
<p style="margin:4px 0 0;font-size:12px;color:#999;">Please reach out as soon as possible.</p>
    `.trim()
  },
  buyer_inquiry: {
    subject: "New {{vertical}} Application — {{business_name}} — {{cityCoverage}}",
    body: `
<h1 style="margin:0 0 16px;font-size:18px;font-weight:700;">New {{vertical}} Application</h1>

${sectionTitle("Business Info")}
<table width="100%" cellpadding="0" cellspacing="0">
  ${row("Business", "{{business_name}}")}
  ${row("Contact", "{{full_name}}")}
  ${row("Phone", '<a href="tel:{{phone}}" style="color:#2563eb;text-decoration:none;">{{phone}}</a>')}
  ${row("Email", '<a href="mailto:{{email}}" style="color:#2563eb;text-decoration:none;">{{email}}</a>')}
  ${row("Years in Business", "{{years_in_business}}")}
</table>

${sectionTitle("Service Coverage")}
<table width="100%" cellpadding="0" cellspacing="0">
  ${row("Areas", "{{cityCoverage}}")}
  ${row("Service Types", "{{serviceTypes}}")}
</table>

${sectionTitle("Message")}
<p style="margin:8px 0;font-size:14px;line-height:1.5;color:#333;">{{message}}</p>
    `.trim()
  },
  feedback_submitted: {
    subject: "New Customer Feedback — {{rating}}/5 for {{hired_plumber}}",
    body: `
<h1 style="margin:0 0 16px;font-size:18px;font-weight:700;">Homeowner Feedback Received</h1>

<table width="100%" cellpadding="0" cellspacing="0">
  ${row("Rating", "{{rating}} / 5")}
  ${row("Hired Plumber", "{{hired_plumber}}")}
</table>

${sectionTitle("Customer Review")}
<p style="margin:8px 0;font-size:14px;line-height:1.5;color:#333;background:#f9fafb;padding:12px 16px;border-radius:8px;border-left:3px solid #2563eb;">"{{review_text}}"</p>

${ctaButton("View Lead Context →", "https://homequotelink.com/admin/leads/{{lead_id}}")}
    `.trim()
  }
};

/* ── Dynamic Template Parser ───────────────────────────────────── */

type TemplateData = Record<string, unknown> & {
  vertical?: string;
  service_areas?: string[];
  service_types?: string[];
  cityCoverage?: string;
  serviceTypes?: string;
  urgency?: string;
  city?: string;
};

function fillTemplate(template: string, data: TemplateData): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    return data[key] !== undefined && data[key] !== null ? String(data[key]).replace(/\n/g, "<br>") : "";
  });
}

function buildDynamicHtml(
  type: "new_lead" | "buyer_notification" | "buyer_inquiry" | "feedback_submitted",
  data: TemplateData,
  customTemplates?: Record<string, { subject: string; body: string }>
): { subject: string; html: string } {
  const tpl = customTemplates?.[type] || DEFAULT_TEMPLATES[type];
  if (!tpl) throw new Error(`Template not found for type: ${type}`);
  
  // Format vertical name for consistency
  if (data.vertical) {
    data.vertical = verticalLabel(data.vertical);
  } else if (type === "buyer_notification" || type === "buyer_inquiry") {
    data.vertical = "Service Provider";
  }

  // Pre-process arrays
  if (data.service_areas && Array.isArray(data.service_areas)) data.cityCoverage = data.service_areas.join(", ");
  if (data.service_types && Array.isArray(data.service_types)) data.serviceTypes = data.service_types.join(", ");

  const subject = fillTemplate(tpl.subject, data);
  let inner = fillTemplate(tpl.body, data);
  
  // Special condition: inject emergency banner for leads
  if (data.urgency === "emergency" && (type === "new_lead" || type === "buyer_notification")) {
    const banner = `<div style="margin:0 0 12px;">${badge("🚨 EMERGENCY", "#dc2626")}</div>`;
    inner = banner + inner;
  }

  // Out of Area banner for admin 
  if (data.city === "Other / Outside SCV" && type === "new_lead") {
    const banner = `<p style="margin:12px 0;padding:10px 14px;background:#fef3c7;border-left:4px solid #f59e0b;border-radius:4px;font-size:13px;">⚠️ Out-of-area lead — manual review required.</p>`;
    inner = banner + inner;
  }

  return { subject, html: htmlWrapper(subject, inner) };
}

function buildTestHtml(config: { smtpHost: string; smtpPort: number; fromEmail: string }): { subject: string; html: string } {
  const subject = "HomeQuoteLink — Test Email";
  const inner = `
<h1 style="margin:0 0 8px;font-size:18px;font-weight:700;">✅ SMTP Working</h1>
<p style="margin:0 0 16px;color:#666;font-size:14px;">Your email configuration is set up correctly.</p>
<table width="100%" cellpadding="0" cellspacing="0">
${row("SMTP Host", config.smtpHost)}
${row("SMTP Port", String(config.smtpPort))}
${row("From", config.fromEmail)}
${row("Timestamp", new Date().toISOString())}
</table>`;

  return { subject, html: htmlWrapper(subject, inner) };
}

/* ── Main handler ─────────────────────────────────────────────── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { notificationType, leadData, eventData, buyerInquiry, nurtureData, feedbackData, testData } = body;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = readServiceRoleKey();
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: settingsRow, error: settingsError } = await supabase
      .from("admin_settings")
      .select("setting_value")
      .eq("setting_key", "smtp_config")
      .maybeSingle();

    if (settingsError) {
      return new Response(
        JSON.stringify({ success: false, error: "Failed to read SMTP settings: " + settingsError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!settingsRow) {
      return new Response(
        JSON.stringify({ success: false, error: "SMTP not configured. Go to Admin → Settings to set up email." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const config = settingsRow.setting_value as {
      smtpHost: string; smtpPort: number; smtpUsername: string; smtpPassword: string;
      fromEmail: string; fromName: string; adminNotificationEmail: string; enabled: boolean;
    };

    if (!config.enabled) {
      return new Response(
        JSON.stringify({ success: false, error: "Email notifications are disabled in settings." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (IMAP_PORTS.includes(config.smtpPort)) {
      const msg = `Port ${config.smtpPort} is an IMAP/POP3 port. Use port 465 (SSL) or 587 (STARTTLS) for sending.`;
      return new Response(
        JSON.stringify({ success: false, error: msg }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: templatesRow } = await supabase
      .from("admin_settings")
      .select("setting_value")
      .eq("setting_key", "email_templates")
      .maybeSingle();
      
    const customTemplates = templatesRow?.setting_value as Record<string, { subject: string; body: string }> | undefined;

    let subject = "";
    let html = "";
    let toEmail = "";
    // Who the recipient is, for the audit trail. Defaults to the admin, which
    // is correct for every branch that mails config.adminNotificationEmail.
    let recipientKind = "admin";

    if (notificationType === "new_lead") {
      const result = buildDynamicHtml("new_lead", leadData, customTemplates);
      subject = result.subject;
      html = result.html;
      toEmail = config.adminNotificationEmail;
    } else if (notificationType === "buyer_notification") {
      const result = buildDynamicHtml("buyer_notification", eventData, customTemplates);
      subject = result.subject;
      html = result.html;
      toEmail = eventData.buyerEmail;
      recipientKind = "buyer";
    } else if (notificationType === "buyer_inquiry") {
      const result = buildDynamicHtml("buyer_inquiry", buyerInquiry, customTemplates);
      subject = result.subject;
      html = result.html;
      toEmail = config.adminNotificationEmail;
    } else if (notificationType === "lead_nurture") {
      subject = nurtureData.subject;
      html = nurtureData.html;
      toEmail = nurtureData.toEmail;
      recipientKind = "lead";
    } else if (notificationType === "feedback_submitted") {
      const result = buildDynamicHtml("feedback_submitted", feedbackData, customTemplates);
      subject = result.subject;
      html = result.html;
      toEmail = config.adminNotificationEmail;
    } else if (notificationType === "test") {
      // If we are passing test template data from the settings UI
      if (testData?.useCustomTemplate) {
        const result = buildDynamicHtml(testData.templateType, testData.mockData, {
           [testData.templateType]: { subject: testData.subject, body: testData.body }
        });
        subject = result.subject;
        html = result.html;
      } else {
        const result = buildTestHtml(config);
        subject = result.subject;
        html = result.html;
      }
      toEmail = config.adminNotificationEmail;
    } else {
      return new Response(
        JSON.stringify({ success: false, error: `Unknown notification type: ${notificationType}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Checked against the REAL recipient, right before the send is attempted —
    // not against a default, and not earlier in the branch above where a
    // caller-supplied `to` (buyerEmail, nurtureData.toEmail) could still
    // legitimately differ. See _shared/mailer.ts's isSelfAddressed for why
    // this exists: it is the same class of bug that caused a real incident
    // in a sibling project, where a notification mailed to itself was
    // re-ingested by an inbound poller as a new lead, forever.
    const breaker = await checkVolumeCircuitBreaker(supabase);
    if (breaker.tripped) {
      await logEmailSend(supabase, {
        jobName: "notify-admin-email",
        emailType: String(notificationType),
        recipientEmail: toEmail,
        recipientKind,
        subject,
        // Never attempted — the breaker tripped before send. html is what
        // WOULD have gone out, kept so a refused send is still auditable.
        body: html,
        status: "failed",
        errorMessage: breaker.reason ?? "Circuit breaker tripped.",
      });
      return new Response(
        JSON.stringify({ success: false, error: breaker.reason }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (isSelfAddressed(toEmail, config)) {
      const message = `Refused: recipient (${toEmail}) is one of this project's own sending addresses.`;
      await logEmailSend(supabase, {
        jobName: "notify-admin-email",
        emailType: String(notificationType),
        recipientEmail: toEmail,
        recipientKind,
        subject,
        // Never attempted — refused as self-addressed before send. html is
        // what WOULD have gone out, kept so a refused send is still auditable.
        body: html,
        status: "failed",
        errorMessage: message,
      });
      return new Response(
        JSON.stringify({ success: false, error: message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const useTls = config.smtpPort === 465;
    console.log(`Connecting to ${config.smtpHost}:${config.smtpPort} (tls: ${useTls})…`);

    const client = new SMTPClient({
      connection: {
        hostname: config.smtpHost,
        port: config.smtpPort,
        tls: useTls,
        auth: { username: config.smtpUsername, password: config.smtpPassword },
      },
    });

    const sendPromise = (async () => {
      await client.send({
        from: `${config.fromName} <${config.fromEmail}>`,
        to: toEmail,
        subject,
        html,
      });
      await client.close();
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`SMTP connection timed out after ${SMTP_TIMEOUT_MS / 1000}s.`)), SMTP_TIMEOUT_MS)
    );

    // Scoped narrowly around the send so that a config/template error above is
    // never recorded as an attempted delivery — only a real send attempt is.
    // Both outcomes are logged with the literal recipient address before this
    // returns; the failure is re-thrown so the outer handler still 500s.
    try {
      await Promise.race([sendPromise, timeoutPromise]);
    } catch (sendErr) {
      await logEmailSend(supabase, {
        jobName: "notify-admin-email",
        emailType: String(notificationType),
        recipientEmail: toEmail,
        recipientKind,
        subject,
        // The real send was attempted and failed; html is exactly what was
        // handed to the SMTP client.
        body: html,
        status: "failed",
        method: "smtp",
        errorMessage: sendErr instanceof Error ? sendErr.message : String(sendErr),
      });
      throw sendErr;
    }

    await logEmailSend(supabase, {
      jobName: "notify-admin-email",
      emailType: String(notificationType),
      recipientEmail: toEmail,
      recipientKind,
      subject,
      // The exact HTML that was successfully sent.
      body: html,
      status: "sent",
      method: "smtp",
    });

    console.log(`Email sent successfully to ${toEmail}`);
    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("notify-admin-email error:", message);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
