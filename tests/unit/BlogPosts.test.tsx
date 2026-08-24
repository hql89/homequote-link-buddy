import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";

/**
 * Regression test for a warning found in a fake/hardcoded-data audit: when
 * the admin_posts query failed, this page rendered "No blog posts yet" —
 * indistinguishable from a real empty result. It must instead say the load
 * failed.
 */

const state = { shouldError: false };

function makeChain(rows: unknown[], shouldError: boolean) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "is", "order", "eq"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (v: { data: unknown; error: unknown }) => void) =>
    resolve(
      shouldError
        ? { data: null, error: { message: "relation \"posts\" permission denied" } }
        : { data: rows, error: null },
    );
  return chain;
}

vi.mock("../../src/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "posts") return makeChain([], state.shouldError);
      throw new Error(`Unexpected table: ${table}`);
    },
  },
}));

vi.mock("../../src/components/admin/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: unknown }) => children,
}));
vi.mock("../../src/components/PageMeta", () => ({ PageMeta: () => null }));

const { default: BlogPostsPage } = await import("../../src/pages/admin/BlogPosts");

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BlogPostsPage />
    </QueryClientProvider>,
  );
}

describe("BlogPostsPage", () => {
  it("shows an explicit error instead of claiming there are no posts when the fetch fails", async () => {
    state.shouldError = true;
    renderPage();

    expect(await screen.findByText("Couldn't load blog posts")).toBeInTheDocument();
    expect(screen.getByText(/permission denied/)).toBeInTheDocument();
    expect(screen.queryByText("No blog posts yet")).not.toBeInTheDocument();
  });

  it("shows the honest empty state when there really are no posts", async () => {
    state.shouldError = false;
    renderPage();

    expect(await screen.findByText("No blog posts yet")).toBeInTheDocument();
  });
});
