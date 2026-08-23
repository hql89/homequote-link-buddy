import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";

/**
 * The property under test: a routing rule fetches updated_at (via select("*"))
 * but previously never showed it — an admin editing routing rules had no way
 * to tell when one was last changed.
 */

const routingRows = [
  {
    id: "r-1",
    city: "Tarzana",
    service_type: "AC Repair",
    buyer_id: "buyer-1",
    max_daily_leads: 5,
    is_active: true,
    after_hours_behavior: "",
    created_at: "2026-06-01T12:00:00Z",
    updated_at: "2026-08-12T12:00:00Z",
    buyers: { business_name: "Lux Air HVAC" },
  },
];

function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "is"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: rows, error: null });
  return chain;
}

vi.mock("../../src/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "routing_settings") return makeChain(routingRows);
      if (table === "buyers") return makeChain([]);
      throw new Error(`Unexpected table: ${table}`);
    },
  },
}));

vi.mock("../../src/components/admin/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: unknown }) => children,
}));

const { default: RoutingPage } = await import("../../src/pages/admin/Routing");

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RoutingPage />
    </QueryClientProvider>,
  );
}

describe("RoutingPage", () => {
  it("shows when the routing rule was last updated", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Tarzana")).toBeInTheDocument());
    expect(screen.getByText("Aug 12, 2026")).toBeInTheDocument();
  });
});
