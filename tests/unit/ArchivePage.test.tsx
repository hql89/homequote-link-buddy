import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, describe, it, expect, beforeEach } from "vitest";

/**
 * The Archive screen is the only way an archived record can be found and put
 * back. What matters: archived rows are actually listed, Restore calls the
 * restore RPC (never a delete), and an empty archive reads as "nothing was
 * removed" rather than as a broken page.
 */
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

const summaryRows = [
  { table_name: "businesses", archived_count: 2 },
  { table_name: "reviews", archived_count: 0 },
  { table_name: "posts", archived_count: 1 },
];

const businessRows = [
  {
    id: "biz-1",
    label: "Griffin's Plumbing",
    archived_at: "2026-08-01T17:30:00Z",
    archived_by: "admin-1",
    archive_reason: "duplicate listing",
    row_data: { business_name: "Griffin's Plumbing", city: "Studio City", phone: "+15626594339" },
  },
  {
    id: "biz-2",
    label: "Lux Air HVAC",
    archived_at: "2026-08-01T16:00:00Z",
    archived_by: "admin-1",
    archive_reason: null,
    row_data: { business_name: "Lux Air HVAC", city: "Encino" },
  },
];

const state = { summaryEmpty: false };

vi.mock("../../src/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === "admin_archived_summary") {
        return Promise.resolve({
          data: state.summaryEmpty
            ? [{ table_name: "businesses", archived_count: 0 }]
            : summaryRows,
          error: null,
        });
      }
      if (fn === "admin_list_archived") {
        return Promise.resolve({
          data: args.p_table === "businesses" ? businessRows : [],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

vi.mock("../../src/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("../../src/components/admin/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: unknown }) => children,
}));
vi.mock("../../src/components/PageMeta", () => ({ PageMeta: () => null }));

const ArchivePage = (await import("../../src/pages/admin/Archive")).default;
// HelpTip renders a Radix tooltip, which App.tsx provides context for at the
// root — same wrapper the PhotoModeration test uses.
const { TooltipProvider } = await import("../../src/components/ui/tooltip");

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <TooltipProvider delayDuration={0}>
      <QueryClientProvider client={qc}>
        <ArchivePage />
      </QueryClientProvider>
    </TooltipProvider>,
  );
}

describe("ArchivePage", () => {
  beforeEach(() => {
    rpcCalls.length = 0;
    state.summaryEmpty = false;
  });

  it("lists archived items with when and why they were removed", async () => {
    renderPage();
    expect(await screen.findByText("Griffin's Plumbing")).toBeInTheDocument();
    expect(screen.getByText("Lux Air HVAC")).toBeInTheDocument();
    expect(screen.getByText(/duplicate listing/)).toBeInTheDocument();
  });

  it("only offers categories that actually contain something", async () => {
    renderPage();
    await screen.findByText("Griffin's Plumbing");
    // reviews has archived_count 0 and must not appear as a category.
    expect(screen.getByText("Directory listings")).toBeInTheDocument();
    expect(screen.getByText("Blog posts")).toBeInTheDocument();
    expect(screen.queryByText("Reviews")).not.toBeInTheDocument();
  });

  it("restores through the restore RPC, never a delete", async () => {
    renderPage();
    await screen.findByText("Griffin's Plumbing");

    fireEvent.click(screen.getAllByRole("button", { name: /restore/i })[0]);

    await waitFor(() => {
      expect(rpcCalls.some((c) => c.fn === "admin_restore_row")).toBe(true);
    });

    const call = rpcCalls.find((c) => c.fn === "admin_restore_row")!;
    expect(call.args).toEqual({ p_table: "businesses", p_id: "biz-1" });
    // Nothing on this screen may destroy a record.
    expect(rpcCalls.some((c) => c.fn === "admin_purge_archived")).toBe(false);
  });

  it("shows the record's contents when a row is expanded", async () => {
    renderPage();
    await screen.findByText("Griffin's Plumbing");

    fireEvent.click(screen.getByText("Griffin's Plumbing"));

    expect(await screen.findByText("Studio City")).toBeInTheDocument();
    expect(screen.getByText("+15626594339")).toBeInTheDocument();
  });

  it("says nothing is archived rather than rendering an empty shell", async () => {
    state.summaryEmpty = true;
    renderPage();
    expect(await screen.findByText("Nothing is archived")).toBeInTheDocument();
  });
});
