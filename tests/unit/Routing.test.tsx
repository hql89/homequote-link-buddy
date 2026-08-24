import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";

/**
 * Properties under test:
 * 1. A routing rule fetches updated_at (via select("*")) but previously
 *    never showed it — an admin editing routing rules had no way to tell
 *    when one was last changed.
 * 2. The vertical/service-type pickers come from the live `verticals` table,
 *    not the long-stale hardcoded VERTICALS map in src/lib/constants.ts
 *    (which only ever had one entry, "tree_service"). "electrical" below
 *    is a slug/service-type pair that never existed in that map.
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

const verticalRows = [
  { id: "v-electrical", slug: "electrical", label: "Electrical", service_types: ["Panel Upgrade"], is_active: true, sort_order: 1 },
];

function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "is"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: rows, error: null });
  return chain;
}

const tablesQueried: string[] = [];

vi.mock("../../src/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      tablesQueried.push(table);
      if (table === "routing_settings") return makeChain(routingRows);
      if (table === "buyers") return makeChain([]);
      if (table === "verticals") return makeChain(verticalRows);
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

  it("sources the vertical/service-type pickers from the live verticals table", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Tarzana")).toBeInTheDocument());

    // If this regressed to the hardcoded VERTICALS map, the live table
    // would never be queried at all.
    expect(tablesQueried).toContain("verticals");
  });
});
