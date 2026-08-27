import { supabase } from "@/integrations/supabase/client";

declare global {
  interface Window {
    gtag?: (command: string, action: string, params?: Record<string, unknown>) => void;
  }
}

// Check if tracking is disabled (admin exclusion)
function isTrackingDisabled(): boolean {
  return localStorage.getItem("hql_ignore_tracking") === "true";
}

// Persistent anonymous visitor ID
export function getVisitorId(): string {
  const key = "hql_visitor_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

// Session ID — resets after 30 min of inactivity
function getSessionId(): string {
  const key = "hql_session_id";
  const tsKey = "hql_session_ts";
  const TIMEOUT = 30 * 60 * 1000; // 30 minutes
  const now = Date.now();
  const lastTs = parseInt(localStorage.getItem(tsKey) || "0", 10);
  let id = localStorage.getItem(key);

  if (!id || now - lastTs > TIMEOUT) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  localStorage.setItem(tsKey, String(now));
  return id;
}

/** Hosts whose traffic is ours, not a visitor's, and must never be recorded. */
function isNonProductionHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    hostname.endsWith(".local") ||
    hostname.includes("lovableproject.com") ||
    hostname.includes("lovable.app")
  );
}

const REDACTED = "redacted";

/** Query params whose value is a credential, not a label. */
const SENSITIVE_PARAM = /(^|[-_])(token|secret|password|key|code)$/i;

/**
 * The claim link mailed to businesses is
 * `/directory/:city/:slug/claim?token=<claim_token>`, and that token is what
 * authorizes claiming the listing. Analytics rows are long-lived and read by
 * more people than the businesses table is, so the token is stripped before an
 * event leaves the browser — for Google as much as for our own table. A visit
 * stays attributable (path, city, slug) without carrying the credential.
 *
 * Applies to referrer too: navigating away from the claim page puts that same
 * tokenised URL in `document.referrer` for the next page view.
 */
function redactSensitiveParams(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(value);
    const url = new URL(value, isAbsolute ? undefined : "http://path.invalid");
    let changed = false;
    for (const name of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_PARAM.test(name)) {
        url.searchParams.set(name, REDACTED);
        changed = true;
      }
    }
    if (!changed) return value;
    return isAbsolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
  } catch {
    // Unparseable, so it cannot be shown to be free of secrets. Drop the whole
    // query rather than guess at its structure.
    const q = value.indexOf("?");
    return q === -1 ? value : `${value.slice(0, q)}?${REDACTED}`;
  }
}

// Extract UTM params from current URL
function getUtmParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    utm_source: params.get("utm_source") || null,
    utm_medium: params.get("utm_medium") || null,
    utm_campaign: params.get("utm_campaign") || null,
    gclid: params.get("gclid") || null,
  };
}

interface TrackEventOptions {
  eventType: "page_view" | "click" | "form_step" | "conversion";
  eventName?: string;
  pagePath?: string;
  metadata?: Record<string, unknown>;
}

/** Google Analytics. Absent measurement ID or gtag script is a no-op, not an error. */
function sendToGoogleAnalytics(
  { eventType, eventName, metadata }: TrackEventOptions,
  pagePath: string,
  pageUrl: string | null,
) {
  if (!import.meta.env.VITE_GA_MEASUREMENT_ID) return;
  if (typeof window.gtag !== "function") return;

  const { gtag } = window;

  if (eventType === "page_view") {
    gtag("event", "page_view", {
      page_path: pagePath,
      page_title: document.title,
      page_location: pageUrl,
      ...metadata,
    });
  } else {
    gtag("event", eventName || eventType, {
      page_path: pagePath,
      ...metadata,
    });
  }
}

/**
 * Our own `analytics_events` table, via the `track-event` edge function.
 *
 * This is the sink we can query — joined against `outreach_sends` it answers
 * whether an emailed business actually visited. Google Analytics cannot be
 * queried from here, so it does not replace this.
 */
async function sendToSupabase(
  { eventType, eventName, metadata }: TrackEventOptions,
  pagePath: string,
  pageUrl: string | null,
) {
  const utmParams = getUtmParams();
  const connection = (navigator as unknown as { connection?: { effectiveType?: string } }).connection;

  await supabase.functions.invoke("track-event", {
    body: {
      event_type: eventType,
      event_name: eventName || null,
      page_path: pagePath,
      referrer: redactSensitiveParams(document.referrer),
      utm_source: utmParams.utm_source,
      utm_medium: utmParams.utm_medium,
      utm_campaign: utmParams.utm_campaign,
      gclid: utmParams.gclid,
      session_id: getSessionId(),
      visitor_id: getVisitorId(),
      user_agent: navigator.userAgent,
      screen_width: window.innerWidth,
      screen_height: window.innerHeight,
      metadata: metadata || null,
      language: navigator.language || null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      page_title: document.title || null,
      page_url: pageUrl,
      connection_type: connection?.effectiveType || null,
      is_touch_device: navigator.maxTouchPoints > 0,
    },
  });
}

export async function trackEvent(options: TrackEventOptions) {
  // Skip tracking if admin exclusion is active
  if (isTrackingDisabled()) {
    return;
  }

  // Skip preview and local development. The Lovable hosts were already
  // excluded; localhost was not, and only escaped notice while trackEvent had
  // no server-side sink to write to. Restoring that sink means every
  // `npm run dev` session would otherwise file real page views against the
  // production table and show up as traffic on the admin dashboard.
  if (isNonProductionHost(window.location.hostname)) {
    return;
  }

  const pagePath =
    redactSensitiveParams(options.pagePath || window.location.pathname) ?? window.location.pathname;
  const pageUrl = redactSensitiveParams(window.location.href);

  // Independent sinks: one being unconfigured or failing must not cost us the
  // other, and neither may take the page down with it.
  const results = await Promise.allSettled([
    Promise.resolve().then(() => sendToGoogleAnalytics(options, pagePath, pageUrl)),
    sendToSupabase(options, pagePath, pageUrl),
  ]);

  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Analytics track error:", result.reason);
    }
  }
}

// Each returns trackEvent's promise so a caller (or a test) can await delivery.
// Callers that don't care may ignore it — trackEvent never rejects.

export function trackPageView(pagePath?: string) {
  return trackEvent({ eventType: "page_view", pagePath });
}

export function trackClick(eventName: string, metadata?: Record<string, unknown>) {
  return trackEvent({ eventType: "click", eventName, metadata });
}

export function trackFormStep(stepName: string, metadata?: Record<string, unknown>) {
  return trackEvent({ eventType: "form_step", eventName: stepName, metadata });
}

export function trackConversion(eventName: string, metadata?: Record<string, unknown>) {
  return trackEvent({ eventType: "conversion", eventName, metadata });
}
