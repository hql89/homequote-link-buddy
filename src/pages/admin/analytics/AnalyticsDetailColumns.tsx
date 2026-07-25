import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { ColumnDef } from "@/components/admin/ConfigurableTable";

// Helper to extract hostname from URL
export function getHostname(url: string | null): string {
  if (!url) return "Direct";
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// Helper to determine device type from screen width
export function getDeviceType(screenWidth: number | null): string {
  if (!screenWidth) return "Unknown";
  if (screenWidth < 768) return "Mobile";
  if (screenWidth < 1024) return "Tablet";
  return "Desktop";
}

/**
 * Cell values arrive as `unknown` from ConfigurableTable, so these coerce
 * safely rather than casting at every call site. An unparseable date renders
 * as an em dash instead of "Invalid Date".
 */
function fmtDate(value: unknown, pattern: string): string {
  if (value === null || value === undefined) return "—";
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? "—" : format(d, pattern);
}

function joinList(value: unknown, separator = ", "): string {
  if (Array.isArray(value)) return value.map(String).join(separator) || "—";
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

export function getAnalyticsColumns(metric: string | undefined, isLeadMetric: boolean, isBlogMetric: boolean): ColumnDef[] {
  // Blog Posts
  if (metric === "blog_posts") {
    return [
      {
        key: "created_at",
        label: "Published",
        visible: true,
        render: (v) => fmtDate(v, "MMM d, yyyy"),
      },
      { key: "title", label: "Title", visible: true },
      { key: "slug", label: "Slug", visible: true },
      { key: "category", label: "Category", visible: true },
      { key: "status", label: "Status", visible: false },
      { 
        key: "tags", 
        label: "Tags", 
        visible: true,
        render: (v) => joinList(v),
      },
      { key: "excerpt", label: "Excerpt", visible: true },
      { key: "meta_description", label: "Meta Description", visible: false },
      { key: "featured_image_url", label: "Featured Image", visible: false },
    ];
  }

  // Blog Views
  if (isBlogMetric) {
    return [
      {
        key: "created_at",
        label: "Viewed At",
        visible: true,
        render: (v) => fmtDate(v, "MMM d, HH:mm:ss"),
      },
      { key: "post_title", label: "Post", visible: true },
      { key: "post_slug", label: "Slug", visible: false },
      { key: "referrer", label: "Referrer", visible: false },
      { key: "referrer_host", label: "Referrer Host", visible: true },
      { key: "session_id", label: "Session", visible: false },
      { key: "user_agent", label: "User Agent", visible: false },
      { key: "ip_address", label: "IP Address", visible: true },
    ];
  }

  // Leads
  if (isLeadMetric) {
    return [
      {
        key: "created_at",
        label: "Date",
        visible: true,
        render: (v) => fmtDate(v, "MMM d, HH:mm"),
      },
      { key: "full_name", label: "Name", visible: true },
      { key: "email", label: "Email", visible: true },
      { key: "phone", label: "Phone", visible: true },
      { 
        key: "vertical", 
        label: "Vertical", 
        visible: true,
        render: (v) => <Badge variant="outline" className="text-xs">{v as string}</Badge>,
      },
      { key: "service_type", label: "Service", visible: true },
      { key: "city", label: "City", visible: true },
      { key: "zip_code", label: "Zip", visible: false },
      { 
        key: "status", 
        label: "Status", 
        visible: true,
        render: (v) => <Badge variant={v === "sold" ? "default" : "outline"} className="text-xs">{v as string}</Badge>,
      },
      { key: "lead_score", label: "Score", visible: true },
      { key: "ai_authenticity_score", label: "AI Score", visible: false },
      { key: "ai_authenticity_reason", label: "AI Reason", visible: false },
      { key: "source", label: "Source (raw)", visible: false },
      { key: "lead_source", label: "Lead Source", visible: true },
      { key: "utm_source", label: "UTM Source", visible: false },
      { key: "utm_medium", label: "UTM Medium", visible: false },
      { key: "utm_campaign", label: "UTM Campaign", visible: false },
      { key: "gclid", label: "GCLID", visible: true },
      { key: "urgency", label: "Urgency", visible: true },
      { key: "description", label: "Description", visible: false },
      { key: "landing_page", label: "Landing Page", visible: false },
      { key: "referrer", label: "Referrer", visible: false },
      { key: "notes", label: "Notes", visible: false },
      { key: "duplicate_flag", label: "Duplicate", visible: false },
      { key: "spam_flag", label: "Spam", visible: false },
      { key: "assigned_buyer_id", label: "Buyer ID", visible: false },
      { key: "preferred_contact_method", label: "Contact Method", visible: false },
    ];
  }

  // Visitors
  if (metric === "visitors") {
    return [
      { key: "visitor_id", label: "Visitor ID", visible: true },
      {
        key: "first_seen",
        label: "First Seen",
        visible: true,
        render: (v) => fmtDate(v, "MMM d, HH:mm"),
      },
      {
        key: "last_seen",
        label: "Last Seen",
        visible: true,
        render: (v) => fmtDate(v, "MMM d, HH:mm"),
      },
      { key: "event_count", label: "Events", visible: true },
      { key: "pages_visited", label: "Pages", visible: true },
      { key: "pages_list", label: "Pages Visited", visible: false },
      { key: "referrer", label: "Referrer (raw)", visible: false },
      { key: "referrer_host", label: "Referrer Host", visible: false },
      { key: "traffic_source", label: "Traffic Source", visible: true },
      { key: "device_type", label: "Device", visible: true },
      { key: "utm_source", label: "UTM Source", visible: false },
      { key: "user_agent", label: "User Agent", visible: false },
      { key: "ip_address", label: "IP Address", visible: true },
      { 
        key: "screen_width", 
        label: "Screen Size", 
        visible: false,
        render: (v, row) => (row as Record<string, unknown>).screen_width && (row as Record<string, unknown>).screen_height ? `${(row as Record<string, unknown>).screen_width}×${(row as Record<string, unknown>).screen_height}` : "—",
      },
      { key: "language", label: "Language", visible: true },
      { key: "timezone", label: "Timezone", visible: true },
      { key: "page_url", label: "Page URL", visible: false },
      { key: "page_title", label: "Page Title", visible: false },
      { key: "connection_type", label: "Connection", visible: false },
      { 
        key: "is_touch_device", 
        label: "Touch Device", 
        visible: false,
        render: (v) => v === true ? "Yes" : v === false ? "No" : "—",
      },
    ];
  }

  // Sessions, Bounce, Pages per Session
  if (metric === "sessions" || metric === "bounce" || metric === "pages_per_session") {
    return [
      { key: "session_id", label: "Session ID", visible: true },
      { key: "visitor_id", label: "Visitor", visible: true },
      {
        key: "start_time",
        label: "Start",
        visible: true,
        render: (v) => fmtDate(v, "MMM d, HH:mm"),
      },
      { key: "event_count", label: "Events", visible: true },
      { key: "page_views", label: "Page Views", visible: true },
      { key: "duration_sec", label: "Duration (s)", visible: true },
      { 
        key: "is_bounce", 
        label: "Bounce", 
        visible: true,
        render: (v) => v ? "Yes" : "No",
      },
      { key: "pages_list", label: "Pages", visible: false },
      { key: "referrer", label: "Referrer (raw)", visible: false },
      { key: "referrer_host", label: "Referrer Host", visible: false },
      { key: "traffic_source", label: "Traffic Source", visible: true },
      { key: "device_type", label: "Device", visible: false },
      { key: "utm_source", label: "UTM Source", visible: false },
      { key: "user_agent", label: "User Agent", visible: false },
      { key: "ip_address", label: "IP Address", visible: true },
      { key: "language", label: "Language", visible: false },
      { key: "timezone", label: "Timezone", visible: false },
      { key: "connection_type", label: "Connection", visible: false },
      { 
        key: "is_touch_device", 
        label: "Touch Device", 
        visible: false,
        render: (v) => v === true ? "Yes" : v === false ? "No" : "—",
      },
    ];
  }

  // Generic events
  return [
    {
      key: "created_at",
      label: "Time",
      visible: true,
      render: (v) => fmtDate(v, "MMM d, HH:mm:ss"),
    },
    { key: "event_type", label: "Type", visible: true },
    { key: "event_name", label: "Name", visible: true },
    { key: "page_path", label: "Page Path", visible: true },
    { key: "visitor_id", label: "Visitor", visible: false },
    { key: "session_id", label: "Session", visible: false },
    { key: "referrer", label: "Referrer (raw)", visible: false },
    { key: "referrer_host", label: "Referrer Host", visible: false },
    { key: "traffic_source", label: "Traffic Source", visible: true },
    { key: "device_type", label: "Device", visible: true },
    { key: "utm_source", label: "UTM Source", visible: false },
    { key: "utm_medium", label: "UTM Medium", visible: false },
    { key: "utm_campaign", label: "UTM Campaign", visible: false },
    { key: "gclid", label: "GCLID", visible: false },
    { key: "user_agent", label: "User Agent", visible: false },
    { key: "ip_address", label: "IP Address", visible: true },
    { 
      key: "screen_width", 
      label: "Screen Size", 
      visible: false,
      render: (v, row) => (row as Record<string, unknown>).screen_width && (row as Record<string, unknown>).screen_height ? `${(row as Record<string, unknown>).screen_width}×${(row as Record<string, unknown>).screen_height}` : "—",
    },
    { 
      key: "metadata", 
      label: "Metadata", 
      visible: false,
      render: (v) => v ? JSON.stringify(v) : "—",
    },
    { key: "language", label: "Language", visible: false },
    { key: "timezone", label: "Timezone", visible: false },
    { key: "page_title", label: "Page Title", visible: false },
    { key: "page_url", label: "Page URL", visible: false },
    { key: "connection_type", label: "Connection", visible: false },
    { 
      key: "is_touch_device", 
      label: "Touch Device", 
      visible: false,
      render: (v) => v === true ? "Yes" : v === false ? "No" : "—",
    },
  ];
}
