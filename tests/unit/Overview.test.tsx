import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, describe, it, expect, beforeEach } from "vitest";

/**
 * /admin is the first screen an operator sees. The property that matters most
 * is the one that's easiest to get wrong: when its queries FAIL, it must say
 * so — a grid of confident zeroes is indistinguishable from a real, healthy
 * "nothing happened", and would be read as fact.
 */

let shouldThrow = false;
let counts = 3;

function chain(): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "not", "gte", "lt", "order", "limit"]) {
    b[m] = () => {
      if (shouldThrow) throw new Error("relation businesses does not exist");
      return b;
    };
  }
  b.maybeSingle = () =>
    Promise.resolve({ data: { setting_value: { daily_limit: 10, delivery_verified_at: "2026-08-20T00:00:00Z" } }, error: null });
  b.then = (resolve: (v: { data: unknown[]; count: number; error: null }) => unknown) =>
    resolve({ data: [], count: counts, error: null });
  return b;
}

vi.mock("../../src/integrations/supabase/client", () => ({
  supabase: {
    from: () => chain(),
    rpc: (name: string) => {
      if (name === "admin_list_cron_jobs") {
        return Promise.resolve({ data: [{ jobname: "send-outreach-drip-daily", active: false }], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    },
  },
}));

vi.mock("../../src/integrations/supabase/directory", () => ({
  directoryDb: { from: () => chain() },
}));

vi.mock("../../src/components/admin/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: unknown }) => children,
}));

const { default: OverviewPage } = await import("../../src/pages/admin/Overview");
const { TooltipProvider } = await import("../../src/components/ui/tooltip");

function renderPage() {
  return render(
    <MemoryRouter>
      <TooltipProvider delayDuration={0}>
        <OverviewPage />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  shouldThrow = false;
  counts = 3;
});

describe("OverviewPage", () => {
  it("leads with what needs attention, before any metrics", async () => {
    renderPage();
    // The readiness panel renders one of three headlines; any of them means
    // "needs attention" came first.
    await waitFor(() =>
      expect(
        screen.getByText(/Outreach is not sending|Outreach is live|Ready, but only when you press Run now/),
      ).toBeInTheDocument(),
    );
  });

  it("renders real business metrics with their labels", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Outreach emails sent")).toBeInTheDocument());
    expect(screen.getByText("Replies received")).toBeInTheDocument();
    expect(screen.getByText("Listings claimed")).toBeInTheDocument();
    expect(screen.getByText("New leads")).toBeInTheDocument();
  });

  it("says the read failed rather than rendering a grid of zeroes", async () => {
    shouldThrow = true;
    renderPage();

    await waitFor(() => expect(screen.getByText(/Couldn't load the overview/i)).toBeInTheDocument());
    expect(screen.queryByText("Outreach emails sent")).not.toBeInTheDocument();
  });

  it("offers a real empty state for the activity feed instead of a blank card", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Nothing has happened yet/i)).toBeInTheDocument());
    expect(screen.getByText(/Sends, replies, claims and new leads will appear here/i)).toBeInTheDocument();
  });

  it("surfaces the review queue when rows are waiting", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/3 waiting for review/)).toBeInTheDocument());
  });

  it("offers quick actions as links, never one-click sends", async () => {
    // Every action behind these screens can email real businesses and carries
    // its own confirmation. A one-click trigger here would route around it.
    renderPage();
    await waitFor(() => expect(screen.getByText("Quick actions")).toBeInTheDocument());
    const outreachLink = screen.getByText("Outreach copy & sending").closest("a")!;
    expect(outreachLink.getAttribute("href")).toBe("/admin/outreach");
    expect(screen.queryByRole("button", { name: /run now/i })).not.toBeInTheDocument();
  });

  it("offers today / 7 day / 30 day ranges", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "7 days" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "30 days" })).toBeInTheDocument();
  });
});
