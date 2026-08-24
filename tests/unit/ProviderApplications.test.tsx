import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";

/**
 * Regression tests for two warnings found in a fake/hardcoded-data audit:
 * 1. When the buyer_profiles (applications) query failed, this page rendered
 *    "No pending applications" — indistinguishable from a real empty queue,
 *    and worse here since it's a moderation queue (a missed application
 *    looks like nothing to review). It must instead say the load failed.
 * 2. The approve-form vertical picker came from the long-stale hardcoded
 *    VERTICALS map (only ever had one entry, "tree_service"). It must come
 *    from the live `verticals` table instead.
 */

const state = { shouldError: false };
const tablesQueried: string[] = [];

const verticalRows = [
  { id: "v-electrical", slug: "electrical", label: "Electrical", service_types: ["Panel Upgrade"], is_active: true, sort_order: 1 },
];

function makeChain(rows: unknown[], shouldError = false) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "is", "order", "eq"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (v: { data: unknown; error: unknown }) => void) =>
    resolve(
      shouldError
        ? { data: null, error: { message: "relation \"buyer_profiles\" permission denied" } }
        : { data: rows, error: null },
    );
  return chain;
}

vi.mock("../../src/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      tablesQueried.push(table);
      if (table === "buyer_profiles") return makeChain([], state.shouldError);
      if (table === "verticals") return makeChain(verticalRows);
      throw new Error(`Unexpected table: ${table}`);
    },
  },
}));

vi.mock("../../src/components/admin/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: unknown }) => children,
}));
vi.mock("../../src/components/PageMeta", () => ({ PageMeta: () => null }));

const { default: ProviderApplicationsPage } = await import("../../src/pages/admin/ProviderApplications");

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProviderApplicationsPage />
    </QueryClientProvider>,
  );
}

describe("ProviderApplicationsPage", () => {
  it("shows an explicit error instead of claiming the queue is empty when the fetch fails", async () => {
    state.shouldError = true;
    renderPage();

    expect(await screen.findByText("Couldn't load applications")).toBeInTheDocument();
    expect(screen.getByText(/permission denied/)).toBeInTheDocument();
    expect(screen.queryByText("No pending applications.")).not.toBeInTheDocument();
  });

  it("shows the honest empty state when there really are no applications", async () => {
    state.shouldError = false;
    renderPage();

    expect(await screen.findByText("No pending applications.")).toBeInTheDocument();
  });

  it("sources the approve-form vertical picker from the live verticals table", async () => {
    state.shouldError = false;
    tablesQueried.length = 0;
    renderPage();

    await waitFor(() => expect(screen.getByText("No pending applications.")).toBeInTheDocument());
    // If this regressed to the hardcoded VERTICALS map, the live table
    // would never be queried at all.
    expect(tablesQueried).toContain("verticals");
  });
});
