import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCounts } from "@/hooks/useAdminCounts";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlarmBanner } from "@/components/admin/AlarmBanner";
import { Users, FileText, Settings, LogOut, Menu, X, Wrench, ExternalLink, BookOpen, Image as ImageIcon, BarChart3, Activity, TrendingUp, UserCheck, Star, Building, Layers, DownloadCloud, ClipboardList, ShieldAlert, Camera, MailOpen, Search, Archive, Send } from "lucide-react";

/**
 * Grouped by where each screen sits in the business's lifecycle, not by when
 * it was built. Previously a flat list in build order — Leads/Buyers first
 * (the original product), then whatever shipped next appended to the end —
 * so the five screens that form one continuous pipeline (import a business →
 * find its email → review it → decide to contact it → send, then watch for
 * replies) were scattered among unrelated ones with no visual relationship.
 *
 * Order within "Directory pipeline" matches the actual left-to-right flow:
 * a business enters via Verticals/Ingestion, gets an email via Email Finder,
 * gets contacted via Outreach, and replies land in Replies. Provider
 * Applications is a second, parallel entry point (a business asking to join
 * directly rather than being imported), so it opens the next group instead.
 */
const navGroups: {
  label: string;
  /** Shown as visible text under the heading, not hover-only — per
   *  HelpTip's own docstring, help that only appears on hover is invisible
   *  on touch and to anyone who doesn't think to look for it, which is
   *  exactly the "I forget how this works" case this exists for. */
  blurb?: string;
  items: { to: string; label: string; icon: typeof FileText }[];
}[] = [
  {
    label: "Directory pipeline",
    blurb: "Verticals → Ingestion brings businesses in. Email Finder finds their address. Outreach contacts them. Replies come back here.",
    items: [
      { to: "/admin/verticals", label: "Verticals", icon: Layers },
      { to: "/admin/ingest", label: "Ingestion", icon: DownloadCloud },
      { to: "/admin/enrichment", label: "Email Finder", icon: Search },
      { to: "/admin/outreach", label: "Outreach", icon: Send },
      { to: "/admin/replies", label: "Replies", icon: MailOpen },
    ],
  },
  {
    label: "Provider content",
    items: [
      { to: "/admin/applications", label: "Applications", icon: ClipboardList },
      { to: "/admin/photos", label: "Photos", icon: Camera },
      { to: "/admin/reviews", label: "Reviews", icon: Star },
      { to: "/admin/spam", label: "Spam", icon: ShieldAlert },
    ],
  },
  {
    label: "Leads & buyers",
    items: [
      { to: "/admin", label: "Leads", icon: FileText },
      { to: "/admin/buyers", label: "Buyers", icon: Users },
      { to: "/admin/routing", label: "Routing", icon: Settings },
      { to: "/admin/homeowners", label: "Homeowners", icon: UserCheck },
      { to: "/admin/buyer-profiles", label: "Profiles", icon: Building },
    ],
  },
  {
    label: "Site content",
    items: [
      { to: "/admin/blog", label: "Blog", icon: BookOpen },
      { to: "/admin/media", label: "Media", icon: ImageIcon },
    ],
  },
  {
    label: "Admin & ops",
    items: [
      { to: "/admin/analytics", label: "Analytics", icon: BarChart3 },
      { to: "/admin/archive", label: "Archive", icon: Archive },
      { to: "/admin/system", label: "System", icon: Activity },
      { to: "/admin/settings", label: "Settings", icon: Wrench },
    ],
  },
];

/** Flattened once for anything (like useAdminCounts lookups) that still just needs "all items". */
const navItems = navGroups.flatMap((g) => g.items);

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { data: counts } = useAdminCounts();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className={cn(
        "flex flex-col border-r bg-sidebar text-sidebar-foreground transition-all duration-200",
        collapsed ? "w-16" : "w-56"
      )}>
        <div className="flex h-16 items-center justify-between px-4 border-b border-sidebar-border">
          {!collapsed && (
            <Link to="/admin" className="flex items-center gap-2">
              <Wrench className="h-5 w-5 text-sidebar-primary" />
              <span className="font-bold font-serif text-sm">HQL Admin</span>
            </Link>
          )}
          <Button variant="ghost" size="icon" onClick={() => setCollapsed(!collapsed)} className="text-sidebar-foreground hover:bg-sidebar-accent">
            {collapsed ? <Menu className="h-4 w-4" /> : <X className="h-4 w-4" />}
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-2">
          {navGroups.map((group, i) => (
            <div key={group.label} className={cn("space-y-1", i > 0 && "mt-4 pt-4 border-t border-sidebar-border")}>
              {!collapsed && (
                <div className="px-3 pb-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
                    {group.label}
                  </p>
                  {group.blurb && (
                    <p className="mt-0.5 text-[10px] leading-snug text-sidebar-foreground/50">{group.blurb}</p>
                  )}
                </div>
              )}
              {group.items.map((item) => {
                const isActive =
                  location.pathname === item.to || (item.to !== "/admin" && location.pathname.startsWith(item.to));
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors relative",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <span className="relative flex-shrink-0">
                      <item.icon className="h-4 w-4" />
                      {collapsed && (counts?.[item.to] ?? 0) > 0 && (
                        <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-destructive" />
                      )}
                    </span>
                    {!collapsed && (
                      <>
                        <span className="flex-1">{item.label}</span>
                        {(counts?.[item.to] ?? 0) > 0 && (
                          <Badge variant="destructive" className="ml-auto h-5 min-w-5 px-1.5 text-[10px] justify-center">
                            {counts![item.to]}
                          </Badge>
                        )}
                      </>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-2 space-y-1">
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          >
            <ExternalLink className="h-4 w-4 flex-shrink-0" />
            {!collapsed && <span>View Site</span>}
          </a>
          {!collapsed && user?.email && (
            <p className="px-3 py-1 text-xs text-sidebar-foreground/50 truncate" title={user.email}>
              {user.email}
            </p>
          )}
          <Button
            variant="ghost"
            size={collapsed ? "icon" : "default"}
            onClick={() => signOut()}
            className="w-full text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground justify-start gap-3"
          >
            <LogOut className="h-4 w-4" />
            {!collapsed && <span>Logout</span>}
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-background">
        <div className="p-6 md:p-8">
          <AlarmBanner />
          {children}
        </div>
      </main>
    </div>
  );
}
