import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, describe, it, expect, beforeEach } from "vitest";

/**
 * Two properties under test.
 *
 * 1. When the schedule can't be read, the panel must not render a job as "Off".
 *    pg_cron isn't installed on this project, so admin_list_cron_jobs throws —
 *    and an "Off" badge would be a claim about state nobody has.
 *
 * 2. Switching on the outreach drip starts autonomous cold email to real
 *    businesses. No RPC may fire until the admin confirms.
 */

type RpcResult = { data: unknown; error: unknown };
const rpcResponses: Record<string, RpcResult> = {};
const rpcCalls: { name: string; args: unknown }[] = [];

vi.mock("../../src/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: unknown) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(rpcResponses[name] ?? { data: null, error: null });
    },
  },
}));

vi.mock("../../src/hooks/use-toast", () => ({ toast: vi.fn() }));

import { TooltipProvider } from "../../src/components/ui/tooltip";
import { BackgroundJobsSettings } from "../../src/pages/admin/settings/BackgroundJobsSettings";

const MISSING_EXTENSION = { code: "42P01", message: 'relation "cron.job" does not exist' };

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // App.tsx mounts TooltipProvider at the root; the panel's HelpTips need it.
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>
        <BackgroundJobsSettings />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpcCalls.length = 0;
  for (const key of Object.keys(rpcResponses)) delete rpcResponses[key];
  rpcResponses["admin_recent_job_runs"] = { data: [], error: null };
  rpcResponses["admin_database_diagnostics"] = { data: null, error: null };
});

describe("BackgroundJobsSettings — schedule unreadable", () => {
  beforeEach(() => {
    rpcResponses["admin_list_cron_jobs"] = { data: null, error: MISSING_EXTENSION };
  });

  it("explains that scheduling is unavailable instead of showing jobs as off", async () => {
    renderPanel();

    await waitFor(() =>
      expect(screen.getByText(/Scheduling is unavailable on this database/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/pg_cron extension isn't installed/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Off$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^On$/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Status unknown/i).length).toBeGreaterThan(0);
  });

  it("disables every job switch", async () => {
    renderPanel();

    await waitFor(() =>
      expect(screen.getByText(/Scheduling is unavailable on this database/i)).toBeInTheDocument(),
    );
    const switches = screen.getAllByRole("switch");
    expect(switches.length).toBeGreaterThan(0);
    switches.forEach((toggle) => expect(toggle).toBeDisabled());
  });

  it("reports a permissions failure differently from a missing extension", async () => {
    rpcResponses["admin_list_cron_jobs"] = {
      data: null,
      error: { code: "P0001", message: "Forbidden" },
    };
    renderPanel();

    await waitFor(() =>
      expect(screen.getByText(/don't have permission to manage jobs/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/pg_cron/i)).not.toBeInTheDocument();
  });

  it("shows the raw message when it can't classify the failure", async () => {
    rpcResponses["admin_list_cron_jobs"] = {
      data: null,
      error: { code: "08006", message: "connection failure" },
    };
    renderPanel();

    await waitFor(() =>
      expect(screen.getByText(/Couldn't read the job schedule/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/connection failure/i)).toBeInTheDocument();
  });
});

describe("BackgroundJobsSettings — schedule readable", () => {
  beforeEach(() => {
    rpcResponses["admin_list_cron_jobs"] = {
      data: [
        {
          jobid: 1,
          jobname: "prune-internal-job-logs-daily",
          schedule: "17 3 * * *",
          active: true,
          command: "SELECT 1;",
        },
      ],
      error: null,
    };
    rpcResponses["admin_toggle_cron_job"] = { data: {}, error: null };
  });

  it("shows real on/off state and no failure notice", async () => {
    renderPanel();

    await waitFor(() => expect(screen.getByText(/^On$/)).toBeInTheDocument());
    expect(screen.getAllByText(/^Off$/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Scheduling is unavailable/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Status unknown/i)).not.toBeInTheDocument();
  });

  it("toggles an ordinary job immediately, with no confirmation", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText(/^On$/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("switch", { name: /Enable Publish scheduled blog posts/i }));

    await waitFor(() =>
      expect(rpcCalls.some((c) => c.name === "admin_toggle_cron_job")).toBe(true),
    );
    expect(rpcCalls.find((c) => c.name === "admin_toggle_cron_job")?.args).toEqual({
      p_jobname: "publish-scheduled-posts",
      p_enable: true,
    });
  });

  it("will not start outreach email without an explicit confirmation", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText(/^On$/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("switch", { name: /Enable Send outreach emails/i }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Start emailing businesses daily\?/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/no per-send review/i)).toBeInTheDocument();
    expect(rpcCalls.some((c) => c.name === "admin_toggle_cron_job")).toBe(false);

    fireEvent.click(within(dialog).getByRole("button", { name: /Cancel/i }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(rpcCalls.some((c) => c.name === "admin_toggle_cron_job")).toBe(false);
  });

  it("stops outreach in one click — turning email off is never gated", async () => {
    rpcResponses["admin_list_cron_jobs"] = {
      data: [
        {
          jobid: 2,
          jobname: "send-outreach-drip-daily",
          schedule: "0 15 * * *",
          active: true,
          command: "SELECT 1;",
        },
      ],
      error: null,
    };
    renderPanel();
    await waitFor(() => expect(screen.getByText(/^On$/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("switch", { name: /Disable Send outreach emails/i }));

    await waitFor(() =>
      expect(rpcCalls.some((c) => c.name === "admin_toggle_cron_job")).toBe(true),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(rpcCalls.find((c) => c.name === "admin_toggle_cron_job")?.args).toEqual({
      p_jobname: "send-outreach-drip-daily",
      p_enable: false,
    });
  });

  it("schedules outreach only after the admin confirms", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText(/^On$/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("switch", { name: /Enable Send outreach emails/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Start sending/i }));

    await waitFor(() =>
      expect(rpcCalls.some((c) => c.name === "admin_toggle_cron_job")).toBe(true),
    );
    expect(rpcCalls.find((c) => c.name === "admin_toggle_cron_job")?.args).toEqual({
      p_jobname: "send-outreach-drip-daily",
      p_enable: true,
    });
  });
});
