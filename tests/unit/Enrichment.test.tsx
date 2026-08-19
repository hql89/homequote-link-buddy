import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";

/**
 * The property this locks in: "Ready for outreach" reflects each business's
 * real `outreach_paused` value on load, and flipping the switch calls
 * setBusinessOutreachPaused with the *inverse* of paused (checked = enabled =
 * !paused) for the right business id — never touching is_published or any
 * other column. A switch that silently no-ops, or that flips the wrong
 * business, is indistinguishable here from a real send being one step away.
 */

const needsReviewRows = [
  {
    id: "review-1",
    business_name: "Maybe Plumbing",
    city: "Encino",
    // Stored E.164, the way businesses.phone actually holds it — the review
    // card's whole job is making these two comparable by eye.
    phone: "+13236535085",
    email: "info@maybeplumbing.test",
    email_source_url: "https://maybeplumbing.test",
    email_source_phone: "+19226367039",
    email_source_address: null,
  },
];

const outreachRows = [
  {
    id: "biz-paused",
    business_name: "Valley Roofing Co",
    city: "Van Nuys",
    phone: "+18182164731",
    email: "hello@valleyroofing.test",
    outreach_paused: true,
    outreach_email_1_sent_at: null,
  },
  {
    id: "biz-paused-2",
    business_name: "Ficus Landscaping",
    city: "Tarzana",
    phone: "555-3333",
    email: "hi@ficuslandscaping.test",
    outreach_paused: true,
    outreach_email_1_sent_at: null,
  },
  {
    id: "biz-enabled",
    business_name: "Sunset Electric",
    city: "Sherman Oaks",
    phone: "555-2222",
    email: "contact@sunsetelectric.test",
    outreach_paused: false,
    outreach_email_1_sent_at: "2026-08-05T00:00:00Z",
  },
];

const outreachToggleCalls: { id: string; paused: boolean }[] = [];
const bulkToggleCalls: { ids: string[]; paused: boolean }[] = [];

function makeBusinessChain() {
  const filters: Record<string, unknown> = {};
  const chain: Record<string, unknown> = {};
  const chainable = ["select", "eq", "not", "order", "is", "in"];
  for (const method of chainable) {
    chain[method] = (...args: unknown[]) => {
      if (method === "eq" || method === "not") filters[String(args[0])] = args[1];
      return chain;
    };
  }
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) => {
    if (filters.email_confidence === "needs_review") {
      resolve({ data: needsReviewRows, error: null });
    } else if (filters.email_confidence === "verified") {
      resolve({ data: outreachRows, error: null });
    } else {
      resolve({ data: [], error: null });
    }
  };
  return chain;
}

vi.mock("../../src/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
    rpc: () => Promise.resolve({ data: [], error: null }),
  },
}));

vi.mock("../../src/hooks/use-toast", () => ({ toast: vi.fn() }));

vi.mock("../../src/components/admin/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: unknown }) => children,
}));

vi.mock("../../src/integrations/supabase/directory", async (importOriginal) => ({
  // Only the data-access surface is stubbed. formatPhoneDisplay is passed
  // through from the real module deliberately: a hand-copied version here
  // could drift from the one the page actually renders with, which is the
  // exact class of bug this test exists to catch.
  ...(await importOriginal<typeof import("../../src/integrations/supabase/directory")>()),
  directoryDb: {
    from: (table: string) => {
      if (table === "businesses") return makeBusinessChain();
      throw new Error(`Unexpected table: ${table}`);
    },
  },
  reviewEnrichedEmail: () => Promise.resolve(null),
  setBusinessOutreachPaused: (id: string, paused: boolean) => {
    outreachToggleCalls.push({ id, paused });
    return Promise.resolve(null);
  },
  setBusinessesOutreachPaused: (ids: string[], paused: boolean) => {
    bulkToggleCalls.push({ ids, paused });
    return Promise.resolve({ updated: ids.length, error: null });
  },
}));

const { default: EnrichmentPage } = await import("../../src/pages/admin/Enrichment");
const { TooltipProvider } = await import("../../src/components/ui/tooltip");

function renderPage() {
  return render(
    <TooltipProvider delayDuration={0}>
      <EnrichmentPage />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  outreachToggleCalls.length = 0;
  bulkToggleCalls.length = 0;
});

describe("EnrichmentPage — Ready for outreach", () => {
  it("lists verified businesses with their current outreach state", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Valley Roofing Co")).toBeInTheDocument());
    expect(screen.getByText("Sunset Electric")).toBeInTheDocument();

    const pausedCard = screen.getByText("Valley Roofing Co").closest("li")!;
    expect(within(pausedCard).getByText("Paused")).toBeInTheDocument();
    expect(within(pausedCard).getByRole("switch")).not.toBeChecked();

    const enabledCard = screen.getByText("Sunset Electric").closest("li")!;
    expect(within(enabledCard).getByText("Enabled")).toBeInTheDocument();
    expect(within(enabledCard).getByRole("switch")).toBeChecked();
  });

  it("flags a business that's already been emailed", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Sunset Electric")).toBeInTheDocument());
    const card = screen.getByText("Sunset Electric").closest("li")!;
    expect(within(card).getByText(/Already emailed/i)).toBeInTheDocument();

    const untouchedCard = screen.getByText("Valley Roofing Co").closest("li")!;
    expect(within(untouchedCard).queryByText(/Already emailed/i)).not.toBeInTheDocument();
  });

  it("turning the switch on sends paused: false for that business only", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Valley Roofing Co")).toBeInTheDocument());
    const card = screen.getByText("Valley Roofing Co").closest("li")!;
    fireEvent.click(within(card).getByRole("switch"));

    await waitFor(() =>
      expect(outreachToggleCalls).toContainEqual({ id: "biz-paused", paused: false }),
    );
    // The already-enabled business wasn't touched by that click.
    expect(outreachToggleCalls.some((c) => c.id === "biz-enabled")).toBe(false);
  });

  it("turning the switch off sends paused: true", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Sunset Electric")).toBeInTheDocument());
    const card = screen.getByText("Sunset Electric").closest("li")!;
    fireEvent.click(within(card).getByRole("switch"));

    await waitFor(() =>
      expect(outreachToggleCalls).toContainEqual({ id: "biz-enabled", paused: true }),
    );
  });

  it("shows the needs-review queue unaffected by the outreach section", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Maybe Plumbing")).toBeInTheDocument());
    expect(screen.getByText("Valley Roofing Co")).toBeInTheDocument();
  });

  it("renders the two compared phone numbers readably, not as raw E.164", async () => {
    // The card's entire purpose is a human deciding whether these two numbers
    // belong to the same business. "+13236535085" vs "+19226367039" is close
    // to unreadable at a glance; the same bug shipped in the outreach email
    // template and was only caught by someone reading a live send.
    renderPage();

    await waitFor(() => expect(screen.getByText("Maybe Plumbing")).toBeInTheDocument());
    const card = screen.getByText("Maybe Plumbing").closest("li")!;

    expect(within(card).getByText("(323) 653-5085")).toBeInTheDocument();
    expect(within(card).getByText("(922) 636-7039")).toBeInTheDocument();
    expect(within(card).queryByText("+13236535085")).not.toBeInTheDocument();
    expect(within(card).queryByText("+19226367039")).not.toBeInTheDocument();
  });

  it("formats the phone in the outreach list too", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Valley Roofing Co")).toBeInTheDocument());
    const card = screen.getByText("Valley Roofing Co").closest("li")!;
    expect(within(card).getByText(/\(818\) 216-4731/)).toBeInTheDocument();
  });

  it("labels the bulk buttons with the count they'll actually affect", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Valley Roofing Co")).toBeInTheDocument());
    // 2 paused (Valley Roofing, Ficus), 1 already enabled (Sunset Electric).
    expect(screen.getByRole("button", { name: "Enable all (2)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause all (1)" })).toBeInTheDocument();
  });

  it("requires confirmation before enabling all, and does not call the bulk setter until confirmed", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Valley Roofing Co")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Enable all (2)" }));

    // The dialog is up; nothing has been sent yet.
    await waitFor(() => expect(screen.getByText(/Enable outreach for 2 businesses\?/)).toBeInTheDocument());
    expect(bulkToggleCalls).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Enable 2" }));

    await waitFor(() => expect(bulkToggleCalls).toHaveLength(1));
    expect(bulkToggleCalls[0].paused).toBe(false);
    expect(new Set(bulkToggleCalls[0].ids)).toEqual(new Set(["biz-paused", "biz-paused-2"]));
    // The business that was already enabled is not included — bulk-enable
    // only ever touches rows that were actually paused.
    expect(bulkToggleCalls[0].ids).not.toContain("biz-enabled");
  });

  it("canceling the enable-all dialog sends nothing", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Valley Roofing Co")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Enable all (2)" }));
    await waitFor(() => expect(screen.getByText(/Enable outreach for 2 businesses\?/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByText(/Enable outreach for 2 businesses\?/)).not.toBeInTheDocument(),
    );
    expect(bulkToggleCalls).toHaveLength(0);
  });

  it("pauses all enabled businesses immediately, with no confirmation dialog", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Sunset Electric")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Pause all (1)" }));

    // No dialog to wait for — pausing, like turning a job off elsewhere in
    // this admin, is always immediate.
    await waitFor(() => expect(bulkToggleCalls).toHaveLength(1));
    expect(bulkToggleCalls[0]).toEqual({ ids: ["biz-enabled"], paused: true });
  });

  it("reflects the bulk result in the switches without a full reload", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Valley Roofing Co")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Enable all (2)" }));
    await waitFor(() => expect(screen.getByText(/Enable outreach for 2 businesses\?/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Enable 2" }));

    await waitFor(() => {
      const card = screen.getByText("Valley Roofing Co").closest("li")!;
      expect(within(card).getByText("Enabled")).toBeInTheDocument();
    });
    const otherCard = screen.getByText("Ficus Landscaping").closest("li")!;
    expect(within(otherCard).getByText("Enabled")).toBeInTheDocument();
  });

  it("disables the buttons instead of showing a zero-count action", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Valley Roofing Co")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Enable all (2)" }));
    await waitFor(() => expect(screen.getByText(/Enable outreach for 2 businesses\?/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Enable 2" }));

    // Everything is now enabled, so "Enable all" has nothing left to do.
    await waitFor(() => expect(screen.getByRole("button", { name: "Enable all (0)" })).toBeDisabled());
  });
});
