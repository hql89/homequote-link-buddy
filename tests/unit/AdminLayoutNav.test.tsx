import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The sidebar was a flat list in build order — Leads/Buyers first (the
 * original product), everything after appended as it shipped — so the five
 * screens that form one continuous pipeline (import a business, find its
 * email, review it, decide to contact it, send, watch for replies) were
 * scattered among unrelated ones with no visual relationship. This pins the
 * regrouping so a future addition can't silently scatter it again.
 */

vi.mock("../../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { email: "admin@homequotelink.com" }, signOut: vi.fn() }),
}));

vi.mock("../../src/hooks/useAdminCounts", () => ({
  useAdminCounts: () => ({ data: {} }),
}));

// AdminLayout now mounts AlarmBanner, which talks to the real client module
// directly (not through useAdminCounts). Mocked here purely so this file's
// nav-structure assertions aren't racing a real network call.
vi.mock("../../src/integrations/supabase/client", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: [], error: null }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
  },
}));

const { AdminLayout } = await import("../../src/components/admin/AdminLayout");

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={["/admin/outreach"]}>
      <AdminLayout>
        <div>page content</div>
      </AdminLayout>
    </MemoryRouter>,
  );
}

describe("AdminLayout sidebar grouping", () => {
  it("groups the directory-pipeline screens together, in pipeline order", () => {
    renderLayout();
    const nav = screen.getByRole("navigation");
    const links = within(nav).getAllByRole("link").map((l) => l.textContent);

    const pipeline = ["Verticals", "Ingestion", "Email Finder", "Outreach", "Sent Emails", "Replies"];
    const positions = pipeline.map((label) => links.indexOf(label));

    // All present, none missing from the flattened link list.
    expect(positions).not.toContain(-1);
    // Strictly increasing == contiguous and in the stated left-to-right flow,
    // not just "somewhere in the same half of the list".
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
    expect(positions[positions.length - 1] - positions[0]).toBe(pipeline.length - 1);
  });

  it("labels each group with a visible heading", () => {
    renderLayout();
    for (const label of ["Directory pipeline", "Provider content", "Leads & buyers", "Site content", "Admin & ops"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("puts Overview above the groups as the landing page", () => {
    renderLayout();
    const nav = screen.getByRole("navigation");
    const links = within(nav).getAllByRole("link");
    expect(links[0].textContent).toBe("Overview");
    expect(links[0].getAttribute("href")).toBe("/admin");
  });

  it("points Leads at its own path now that /admin is the Overview", () => {
    // The leads table used to BE /admin. If this link isn't repointed it
    // silently lands on the overview and the leads table becomes unreachable
    // from the sidebar.
    renderLayout();
    const nav = screen.getByRole("navigation");
    const leads = within(nav).getByText("Leads").closest("a")!;
    expect(leads.getAttribute("href")).toBe("/admin/leads");
  });

  it("has a sidebar link for every admin page that is not a drill-down", () => {
    // The real complaint: /admin/outreach/sent existed as a working page with
    // no way to click to it. Parameterised routes (:id, :metric) are reached
    // by clicking a row or card, /admin/login is pre-auth, and
    // /admin/site-analytics is a redirect — everything else must be clickable.
    const app = readFileSync("src/App.tsx", "utf8");
    const routes = [...app.matchAll(/path="(\/admin[^"]*)"/g)]
      .map((m) => m[1])
      .filter((r) => !r.includes(":"))
      .filter((r) => r !== "/admin/login" && r !== "/admin/site-analytics");

    const layout = readFileSync("src/components/admin/AdminLayout.tsx", "utf8");
    const linked = new Set([...layout.matchAll(/to: "(\/admin[^"]*)"/g)].map((m) => m[1]));

    const unreachable = routes.filter((r) => !linked.has(r));
    expect(unreachable).toEqual([]);
  });

  it("links to Sent Emails, and highlights only it — not its parent — when open", () => {
    render(
      <MemoryRouter initialEntries={["/admin/outreach/sent"]}>
        <AdminLayout><div>content</div></AdminLayout>
      </MemoryRouter>,
    );
    const nav = screen.getByRole("navigation");

    const sent = within(nav).getByText("Sent Emails").closest("a")!;
    const outreach = within(nav).getByText("Outreach").closest("a")!;
    const overview = within(nav).getByText("Overview").closest("a")!;

    // Exact class tokens, not substring: the INACTIVE style contains
    // "hover:bg-sidebar-accent", which a toContain() check matches too.
    const isHighlighted = (el: Element) => el.className.split(/\s+/).includes("bg-sidebar-accent");

    // A plain startsWith would light up all three at once.
    expect(isHighlighted(sent)).toBe(true);
    expect(isHighlighted(outreach)).toBe(false);
    expect(isHighlighted(overview)).toBe(false);
  });

  it("still highlights the parent for a drill-down route with no nav item of its own", () => {
    render(
      <MemoryRouter initialEntries={["/admin/leads/some-lead-id"]}>
        <AdminLayout><div>content</div></AdminLayout>
      </MemoryRouter>,
    );
    const nav = screen.getByRole("navigation");
    expect(
      within(nav).getByText("Leads").closest("a")!.className.split(/\s+/),
    ).toContain("bg-sidebar-accent");
  });

  it("explains the pipeline as visible text, not hover-only help", () => {
    // HelpTip's own docstring: hover-only help is invisible on touch devices
    // and to anyone who doesn't think to look for it — "I forget how this
    // works" is exactly that case, so this has to be plain text on the page.
    renderLayout();
    expect(
      screen.getByText(/Verticals.*Ingestion brings businesses in/i),
    ).toBeInTheDocument();
  });

  it("still renders every screen that existed before the regroup", () => {
    renderLayout();
    const nav = screen.getByRole("navigation");
    for (const label of [
      "Leads", "Buyers", "Routing", "Blog", "Media", "Analytics", "Homeowners", "Reviews",
      "Profiles", "Applications", "Verticals", "Ingestion", "Email Finder", "Outreach",
      "Photos", "Replies", "Spam", "Archive", "System", "Settings",
    ]) {
      expect(within(nav).getByText(label)).toBeInTheDocument();
    }
  });
});
