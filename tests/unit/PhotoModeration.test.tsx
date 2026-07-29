import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";

/**
 * The property this locks in: approving or rejecting a photo removes it from
 * the pending list immediately. A queue that still shows a photo as "pending"
 * after the admin acted on it would read as the action having silently
 * failed — indistinguishable, from the admin's chair, from the RLS policy
 * having rejected the write.
 */

const photoRows = [
  {
    id: "photo-1",
    business_id: "biz-1",
    storage_path: "biz-1/one.jpg",
    caption: "Finished install",
    sort_order: 0,
    status: "pending",
    created_at: "2026-07-20T00:00:00Z",
  },
  {
    id: "photo-2",
    business_id: "biz-2",
    storage_path: "biz-2/two.jpg",
    caption: null,
    sort_order: 0,
    status: "pending",
    created_at: "2026-07-21T00:00:00Z",
  },
];

const businessRows = [
  { id: "biz-1", business_name: "Lux Air HVAC", city: "Tarzana" },
  { id: "biz-2", business_name: "Perfect Electric Inc", city: "Studio City" },
];

const updateCalls: { id: string; status: string }[] = [];

function makeChain(finalRows: unknown[]) {
  const chain: Record<string, unknown> = {};
  const chainable = ["select", "eq", "in", "order"];
  for (const method of chainable) {
    chain[method] = () => chain;
  }
  // The query's terminal await resolves the accumulated chain to a result.
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) =>
    resolve({ data: finalRows, error: null });
  return chain;
}

vi.mock("../../src/integrations/supabase/client", () => ({ supabase: {} }));

vi.mock("../../src/hooks/use-toast", () => ({ toast: vi.fn() }));

// AdminLayout pulls in routing context and auth/count queries that are the
// sidebar chrome's concern, not this page's. Isolate the unit under test.
vi.mock("../../src/components/admin/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: unknown }) => children,
}));

vi.mock("../../src/integrations/supabase/directory", () => ({
  directoryDb: {
    from: (table: string) => {
      if (table === "business_photos") return makeChain(photoRows);
      if (table === "businesses") return makeChain(businessRows);
      throw new Error(`Unexpected table: ${table}`);
    },
    storage: {
      from: () => ({
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
      }),
    },
  },
  setBusinessPhotoStatus: (id: string, status: string) => {
    updateCalls.push({ id, status });
    return Promise.resolve(null);
  },
}));

const { default: PhotoModerationPage } = await import("../../src/pages/admin/PhotoModeration");
const { TooltipProvider } = await import("../../src/components/ui/tooltip");

function renderPage() {
  return render(
    <TooltipProvider delayDuration={0}>
      <PhotoModerationPage />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  updateCalls.length = 0;
});

describe("PhotoModerationPage", () => {
  it("lists pending photos with their business context", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Lux Air HVAC")).toBeInTheDocument());
    expect(screen.getByText("Perfect Electric Inc")).toBeInTheDocument();
    expect(screen.getByText("2 pending")).toBeInTheDocument();
  });

  it("approving a photo sends status='approved' and removes it from the list", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Lux Air HVAC")).toBeInTheDocument());

    const card = screen.getByText("Lux Air HVAC").closest("li")!;
    fireEvent.click(within(card).getByRole("button", { name: /approve/i }));

    await waitFor(() => expect(screen.queryByText("Lux Air HVAC")).not.toBeInTheDocument());
    expect(updateCalls).toContainEqual({ id: "photo-1", status: "approved" });
    // The other business's photo is untouched.
    expect(screen.getByText("Perfect Electric Inc")).toBeInTheDocument();
  });

  it("rejecting a photo sends status='rejected' and removes it from the list", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Perfect Electric Inc")).toBeInTheDocument());

    const card = screen.getByText("Perfect Electric Inc").closest("li")!;
    fireEvent.click(within(card).getByRole("button", { name: /reject/i }));

    await waitFor(() => expect(screen.queryByText("Perfect Electric Inc")).not.toBeInTheDocument());
    expect(updateCalls).toContainEqual({ id: "photo-2", status: "rejected" });
  });

  it("shows an empty state once nothing is pending", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Lux Air HVAC")).toBeInTheDocument());
    fireEvent.click(within(screen.getByText("Lux Air HVAC").closest("li")!).getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(screen.queryByText("Lux Air HVAC")).not.toBeInTheDocument());
    fireEvent.click(within(screen.getByText("Perfect Electric Inc").closest("li")!).getByRole("button", { name: /reject/i }));

    await waitFor(() => expect(screen.getByText("Nothing waiting for review.")).toBeInTheDocument());
  });
});
