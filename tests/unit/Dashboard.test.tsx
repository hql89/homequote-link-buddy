import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";

/**
 * Regression test for a warning found in a fake/hardcoded-data audit: the
 * Vertical/Service filters on the leads dashboard came from the long-stale
 * hardcoded VERTICALS map in src/lib/constants.ts (only ever had one entry,
 * "tree_service"), hiding every other real vertical. They must come from
 * the live `verticals` table instead.
 */

const tablesQueried: string[] = [];

const verticalRows = [
  { id: "v-electrical", slug: "electrical", label: "Electrical", service_types: ["Panel Upgrade"], is_active: true, sort_order: 1 },
];

function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "order", "range", "eq", "neq", "or", "is"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (v: { data: unknown; error: null; count: number }) => void) =>
    resolve({ data: rows, error: null, count: rows.length });
  return chain;
}

vi.mock("../../src/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      tablesQueried.push(table);
      if (table === "leads") return makeChain([]);
      if (table === "verticals") return makeChain(verticalRows);
      throw new Error(`Unexpected table: ${table}`);
    },
  },
}));

vi.mock("../../src/components/admin/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: unknown }) => children,
}));
vi.mock("../../src/components/PageMeta", () => ({ PageMeta: () => null }));

const { default: AdminDashboard } = await import("../../src/pages/admin/Dashboard");

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <AdminDashboard />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("AdminDashboard", () => {
  it("sources the vertical/service filters from the live verticals table", async () => {
    renderPage();

    // If this regressed to the hardcoded VERTICALS map, the live table
    // would never be queried at all.
    await waitFor(() => expect(tablesQueried).toContain("verticals"));
  });
});
