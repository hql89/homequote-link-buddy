import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";

/**
 * The property under test: the homeowner detail dialog's "Linked Leads" and
 * "Reviews" sub-lists both fetch created_at but previously never showed it —
 * an admin looking for repeat customers had no way to tell when a linked
 * lead came in or when a review was left.
 */

const homeownerRows = [
  {
    id: "ho-1",
    user_id: "user-1",
    full_name: "Jane Doe",
    email: "jane@example.com",
    phone: "555-0100",
    linked_lead_ids: ["lead-1"],
    created_at: "2026-06-01T12:00:00Z",
  },
];

const leadRows = [
  { id: "lead-1", full_name: "Jane Doe", service_type: "AC Repair", status: "new", created_at: "2026-07-20T12:00:00Z" },
];

const reviewRows = [
  {
    id: "review-1",
    rating: 5,
    review_text: "Great service",
    created_at: "2026-07-25T12:00:00Z",
    buyers: { business_name: "Lux Air HVAC" },
  },
];

function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: rows, error: null });
  return chain;
}

vi.mock("../../src/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "homeowner_profiles") return makeChain(homeownerRows);
      if (table === "leads") return makeChain(leadRows);
      if (table === "reviews") return makeChain(reviewRows);
      throw new Error(`Unexpected table: ${table}`);
    },
  },
}));

vi.mock("../../src/components/admin/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: unknown }) => children,
}));

const { default: Homeowners } = await import("../../src/pages/admin/Homeowners");

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Homeowners />
    </QueryClientProvider>,
  );
}

describe("Homeowners", () => {
  it("shows the date on each linked lead and each review in the detail dialog", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Jane Doe"));

    await waitFor(() => expect(screen.getByText(/AC Repair — Jane Doe/)).toBeInTheDocument());
    expect(screen.getByText("Jul 20, 2026")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Great service")).toBeInTheDocument());
    expect(screen.getByText("Jul 25, 2026")).toBeInTheDocument();
  });
});
