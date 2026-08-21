import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, describe, it, expect } from "vitest";

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
  it("groups the five directory-pipeline screens together, in pipeline order", () => {
    renderLayout();
    const nav = screen.getByRole("navigation");
    const links = within(nav).getAllByRole("link").map((l) => l.textContent);

    const pipeline = ["Verticals", "Ingestion", "Email Finder", "Outreach", "Replies"];
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
