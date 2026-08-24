import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";

/**
 * Regression test for a warning found in a fake/hardcoded-data audit: when
 * the media_assets query failed, this page rendered "No media assets yet" —
 * indistinguishable from a real empty result. It must instead say the load
 * failed.
 */

const state = { shouldError: false };

function makeChain(rows: unknown[], shouldError: boolean) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "is", "order", "or"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (v: { data: unknown; error: unknown }) => void) =>
    resolve(
      shouldError
        ? { data: null, error: { message: "relation \"media_assets\" permission denied" } }
        : { data: rows, error: null },
    );
  return chain;
}

vi.mock("../../src/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "media_assets") return makeChain([], state.shouldError);
      throw new Error(`Unexpected table: ${table}`);
    },
  },
}));

vi.mock("../../src/components/admin/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: unknown }) => children,
}));
vi.mock("../../src/components/PageMeta", () => ({ PageMeta: () => null }));

const { default: MediaLibraryPage } = await import("../../src/pages/admin/MediaLibrary");

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MediaLibraryPage />
    </QueryClientProvider>,
  );
}

describe("MediaLibraryPage", () => {
  it("shows an explicit error instead of claiming there are no assets when the fetch fails", async () => {
    state.shouldError = true;
    renderPage();

    expect(await screen.findByText("Couldn't load the media library")).toBeInTheDocument();
    expect(screen.getByText(/permission denied/)).toBeInTheDocument();
    expect(screen.queryByText("No media assets yet")).not.toBeInTheDocument();
  });

  it("shows the honest empty state when there really are no assets", async () => {
    state.shouldError = false;
    renderPage();

    expect(await screen.findByText("No media assets yet")).toBeInTheDocument();
  });
});
