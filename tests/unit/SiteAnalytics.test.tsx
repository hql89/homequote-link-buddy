import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";

/**
 * Regression test for a warning found in a fake/hardcoded-data audit: this
 * page's banner claimed the charts below were "Legacy Internal Data
 * collected prior to the migration" to GA4, while the surrounding code
 * actually runs live queries for whatever date range is selected — live,
 * current data mislabeled as a stale historical snapshot.
 */

// This page queries many tables (admin_settings, analytics_events, leads,
// buyers, post_metrics, posts). None of them are what this test cares
// about, so every query resolves to an empty, honest result rather than
// asserting call-by-call shape.
function makeChain() {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "lt", "order", "limit"]) {
    chain[method] = () => chain;
  }
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
  chain.then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
    resolve({ data: [], error: null });
  return chain;
}

vi.mock("../../src/integrations/supabase/client", () => ({
  supabase: {
    from: () => makeChain(),
  },
}));

vi.mock("../../src/components/admin/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: unknown }) => children,
}));
vi.mock("../../src/components/PageMeta", () => ({ PageMeta: () => null }));

const { default: SiteAnalyticsPage } = await import("../../src/pages/admin/SiteAnalytics");

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SiteAnalyticsPage />
    </QueryClientProvider>,
  );
}

describe("SiteAnalyticsPage", () => {
  it("does not claim the live charts below are a legacy pre-migration snapshot", async () => {
    renderPage();

    expect(await screen.findByText(/live internal data/i)).toBeInTheDocument();
    expect(screen.queryByText(/Legacy Internal Data/)).not.toBeInTheDocument();
    expect(screen.queryByText(/collected prior to the migration/)).not.toBeInTheDocument();
  });
});
