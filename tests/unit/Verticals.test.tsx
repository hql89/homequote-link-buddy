import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";

/**
 * The property under test: the verticals table fetches created_at/updated_at
 * (proven by Verticals.tsx itself destructuring them out of the edit form)
 * but previously never showed either — an admin had no way to tell when a
 * vertical was last changed.
 */

const verticalRows = [
  {
    id: "v-1",
    slug: "hvac",
    label: "HVAC / AC",
    professional_label: "technician",
    professional_label_plural: "technicians",
    service_types: ["AC Repair"],
    is_active: true,
    sort_order: 1,
    icon_name: null,
    hero_title: null,
    hero_description: null,
    meta_title: null,
    meta_description: null,
    created_at: "2026-06-01T12:00:00Z",
    updated_at: "2026-08-10T12:00:00Z",
  },
];

function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: rows, error: null });
  return chain;
}

vi.mock("../../src/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "verticals") return makeChain(verticalRows);
      throw new Error(`Unexpected table: ${table}`);
    },
  },
}));

vi.mock("../../src/components/admin/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: unknown }) => children,
}));

const { default: VerticalsPage } = await import("../../src/pages/admin/Verticals");

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <VerticalsPage />
    </QueryClientProvider>,
  );
}

describe("VerticalsPage", () => {
  it("shows when the vertical was last updated", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("HVAC / AC")).toBeInTheDocument());
    expect(screen.getByText("Aug 10, 2026")).toBeInTheDocument();
  });
});
