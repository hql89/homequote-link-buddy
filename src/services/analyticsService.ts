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

export async function trackEvent({ eventType, eventName, pagePath, metadata }: TrackEventOptions) {
  // Skip tracking if admin exclusion is active
  if (isTrackingDisabled()) {
    return;
  }

  // Skip tracking for Lovable preview environments
  const hostname = window.location.hostname;
  if (hostname.includes('lovableproject.com') || hostname.includes('lovable.app')) {
    return;
  }
  
  try {
    const gaMeasurementId = import.meta.env.VITE_GA_MEASUREMENT_ID;
    if (!gaMeasurementId) {
      // Missing ID, fail silently in production to avoid clutter
      return;
    }

    if (typeof window.gtag !== 'function') {
      return;
    }

    const { gtag } = window;

    if (eventType === "page_view") {
      gtag('event', 'page_view', {
        page_path: pagePath || window.location.pathname,
        page_title: document.title,
        page_location: window.location.href,
        ...metadata
      });
    } else {
      gtag('event', eventName || eventType, {
        page_path: pagePath || window.location.pathname,
        ...metadata
      });
    }
  } catch (e) {
    // Silent fail — analytics should never break the app
    console.error("Analytics track error:", e);
  }
}

export function trackPageView(pagePath?: string) {
  trackEvent({ eventType: "page_view", pagePath });
}

export function trackClick(eventName: string, metadata?: Record<string, unknown>) {
  trackEvent({ eventType: "click", eventName, metadata });
}

export function trackFormStep(stepName: string, metadata?: Record<string, unknown>) {
  trackEvent({ eventType: "form_step", eventName: stepName, metadata });
}

export function trackConversion(eventName: string, metadata?: Record<string, unknown>) {
  trackEvent({ eventType: "conversion", eventName, metadata });
}
