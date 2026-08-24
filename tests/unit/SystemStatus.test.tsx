import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";

/**
 * Regression test for a warning found in a fake/hardcoded-data audit: every
 * cron job in the list got an unconditional green "healthy" checkmark, even
 * though admin_list_cron_jobs() (surfaced here as job.active) reports
 * whether pg_cron actually has the job enabled. A disabled job must not
 * look identical to an active one.
 */

const statusPayload = {
  timestamp: "2026-08-23T12:00:00Z",
  edgeFunctions: [],
  storage: [],
  database: { posts: 0, leads: 0, buyers: 0, postMetrics: 0, postVersions: 0 },
  cronJobs: [
    { jobname: "send-outreach-drip", schedule: "0 * * * *", active: true },
    { jobname: "old-disabled-job", schedule: "0 0 * * *", active: false },
  ],
};

vi.mock("../../src/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: async () => ({ data: statusPayload, error: null }),
    },
  },
}));

vi.mock("../../src/components/admin/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: unknown }) => children,
}));
vi.mock("../../src/components/PageMeta", () => ({ PageMeta: () => null }));

const { default: SystemStatusPage } = await import("../../src/pages/admin/SystemStatus");

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SystemStatusPage />
    </QueryClientProvider>,
  );
}

describe("SystemStatusPage", () => {
  it("marks a disabled cron job as disabled instead of showing it as healthy", async () => {
    renderPage();

    await screen.findByText("send-outreach-drip");
    const jobLabel = screen.getByText("old-disabled-job");
    // Scoped to this job's own row, rather than getByText(/disabled/) which
    // ambiguously matches multiple ancestor elements sharing the same text.
    expect(jobLabel.closest("div")?.textContent).toContain("disabled");
  });
});
