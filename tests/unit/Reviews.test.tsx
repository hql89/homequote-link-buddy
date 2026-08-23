import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";

/**
 * Regression test for a blocker found in a fake/hardcoded-data audit: when
 * the reviews query failed, this page rendered a completely blank table body
 * with zero rows and zero explanation — indistinguishable from "no reviews
 * exist" to an admin. It must instead say the load failed.
 */

const state = { reviewsShouldError: false };

function makeChain(rows: unknown[], shouldError: boolean) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "is", "order", "eq"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (v: { data: unknown; error: unknown }) => void) =>
    resolve(
      shouldError
        ? { data: null, error: { message: "relation \"reviews\" permission denied" } }
        : { data: rows, error: null },
    );
  return chain;
}

vi.mock("../../src/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "reviews") return makeChain([], state.reviewsShouldError);
      if (table === "homeowner_profiles") return makeChain([], false);
      throw new Error(`Unexpected table: ${table}`);
    },
  },
}));

vi.mock("../../src/components/admin/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: unknown }) => children,
}));

const { default: ReviewsPage } = await import("../../src/pages/admin/Reviews");

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ReviewsPage />
    </QueryClientProvider>,
  );
}

describe("ReviewsPage", () => {
  it("shows an explicit error instead of a blank table when the fetch fails", async () => {
    state.reviewsShouldError = true;
    renderPage();

    expect(await screen.findByText("Couldn't load reviews")).toBeInTheDocument();
    expect(screen.getByText(/permission denied/)).toBeInTheDocument();
    // Must not be confused with the honest empty-result state.
    expect(screen.queryByText("No reviews")).not.toBeInTheDocument();
  });

  it("shows the honest empty state when there really are no reviews", async () => {
    state.reviewsShouldError = false;
    renderPage();

    await waitFor(() => expect(screen.getByText("No reviews")).toBeInTheDocument());
  });
});
