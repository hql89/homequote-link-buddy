import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";

/**
 * The property under test: a buyer row fetches created_at (via select("*"))
 * but previously never showed it — an admin had no way to tell how long a
 * buyer has been receiving leads.
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
});
