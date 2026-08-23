import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";

/**
 * Regression test for a blocker found in a fake/hardcoded-data audit: when
 * the spam_events query failed, this page rendered "No spam events in this
 * time range — looking clean!" — fabricated reassurance on a
 * security-monitoring page when the true state was "unknown, the query
 * failed." It must say the load failed, not that everything is clean.
 */

const state = { shouldError: false };

function makeChain(rows: unknown[], shouldError: boolean) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "gte", "order", "limit"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (v: { data: unknown; error: unknown }) => void) =>
    resolve(
      shouldError
        ? { data: null, error: { message: "relation \"spam_events\" permission denied" } }
        : { data: rows, error: null },
    );
  return chain;
}

vi.mock("../../src/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "spam_events") return makeChain([], state.shouldError);
      throw new Error(`Unexpected table: ${table}`);
    },
  },
}));

vi.mock("../../src/components/admin/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: unknown }) => children,
}));
vi.mock("../../src/components/PageMeta", () => ({ PageMeta: () => null }));

const { default: SpamMonitor } = await import("../../src/pages/admin/SpamMonitor");

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SpamMonitor />
    </QueryClientProvider>,
  );
}

describe("SpamMonitor", () => {
  it("shows an explicit error instead of claiming things look clean when the fetch fails", async () => {
    state.shouldError = true;
    renderPage();

    expect(await screen.findByText("Couldn't load spam events")).toBeInTheDocument();
    expect(screen.getByText(/permission denied/)).toBeInTheDocument();
    expect(
      screen.queryByText("No spam events in this time range — looking clean!"),
    ).not.toBeInTheDocument();
    // Summary counts must not silently show zero as if that were real.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows the honest empty state when there really are no spam events", async () => {
    state.shouldError = false;
    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/No spam events in this time range — looking clean!/)).toBeInTheDocument(),
    );
  });
});
