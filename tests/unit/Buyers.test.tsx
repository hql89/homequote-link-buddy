import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";

/**
 * The properties under test:
 * 1. A buyer row fetches created_at (via select("*")) but previously never
 *    showed it — an admin had no way to tell how long a buyer has been
 *    receiving leads.
 * 2. The vertical shown for a buyer comes from the live `verticals` table,
 *    not the long-stale hardcoded VERTICALS map in src/lib/constants.ts
 *    (which only ever had one entry, "tree_service"). "landscaping" below
 *    is a slug that never existed in that map — if this page regressed to
 *    reading the hardcoded map, this label would be missing/wrong.
 */

const buyerRows = [
  {
    id: "buyer-1",
    business_name: "Lux Air HVAC",
    contact_name: "Sam",
    email: "sam@luxairhvac.com",
    phone: "555-0100",
    vertical: "hvac",
    is_active: true,
    daily_lead_cap: 5,
    service_areas: [],
    supported_service_types: [],
    notes: null,
    archived_at: null,
    created_at: "2026-05-04T12:00:00Z",
    updated_at: "2026-05-04T12:00:00Z",
  },
  {
    id: "buyer-2",
    business_name: "Valley Yards",
    contact_name: "Pat",
    email: "pat@valleyyards.com",
    phone: "555-0101",
    vertical: "landscaping",
    is_active: true,
    daily_lead_cap: 5,
    service_areas: [],
    supported_service_types: [],
    notes: null,
    archived_at: null,
    created_at: "2026-05-05T12:00:00Z",
    updated_at: "2026-05-05T12:00:00Z",
  },
];

const verticalRows = [
  { id: "v-hvac", slug: "hvac", label: "HVAC", is_active: true, sort_order: 1 },
  { id: "v-landscaping", slug: "landscaping", label: "Landscaping & Hardscape", is_active: true, sort_order: 2 },
];

function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: rows, error: null });
  return chain;
}

vi.mock("../../src/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "buyers") return makeChain(buyerRows);
      if (table === "verticals") return makeChain(verticalRows);
      throw new Error(`Unexpected table: ${table}`);
    },
  },
}));

vi.mock("../../src/components/admin/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: unknown }) => children,
}));

const { default: BuyersPage } = await import("../../src/pages/admin/Buyers");

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BuyersPage />
    </QueryClientProvider>,
  );
}

describe("BuyersPage", () => {
  it("shows when the buyer was added", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Lux Air HVAC")).toBeInTheDocument());
    expect(screen.getByText("May 4, 2026")).toBeInTheDocument();
  });

  it("shows the buyer's vertical label from the live verticals table", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Valley Yards")).toBeInTheDocument());
    // Not the raw slug, and not anything derived from the hardcoded
    // VERTICALS map (which has no "landscaping" entry at all).
    expect(screen.getByText("Landscaping & Hardscape")).toBeInTheDocument();
  });
});
