import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";

/**
 * The property that matters most here: the "turn on the delivery check"
 * shortcut must only ever appear after a CONFIRMED delivery (a human
 * clicking "Yes, it arrived"), never merely after a send succeeding. Those
 * are different claims — conflating them is exactly what made the Byethost
 * outage take days to diagnose, since the server accepted every message
 * right up until it silently discarded each one.
 */
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
const invokeResult: { data: unknown; error: unknown } = { data: { success: true }, error: null };
const rpcError: { value: { message: string } | null } = { value: null };

vi.mock("../../src/integrations/supabase/client", () => {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    upsert: () => Promise.resolve({ error: null }),
  };
  return {
    supabase: {
      from: () => builder,
      functions: { invoke: () => Promise.resolve(invokeResult) },
      rpc: (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return Promise.resolve({ data: null, error: rpcError.value });
      },
    },
  };
});

vi.mock("../../src/hooks/use-toast", () => ({ toast: vi.fn() }));

const { SMTPSettings } = await import("../../src/pages/admin/settings/SMTPSettings");

const baseConfig = {
  smtpHost: "sv20.byethost20.org",
  smtpPort: 465,
  smtpUsername: "admin@homequotelink.com",
  smtpPassword: "the-new-password",
  fromEmail: "admin@homequotelink.com",
  fromName: "Home Quote Link",
  adminNotificationEmail: "dgarcia89@gmail.com",
  enabled: true,
};

function renderPanel() {
  const addLog = vi.fn();
  render(<SMTPSettings config={baseConfig} setConfig={() => {}} addLog={addLog} />);
  return { addLog };
}

describe("SMTPSettings — test/confirm/canary flow", () => {
  beforeEach(() => {
    rpcCalls.length = 0;
    rpcError.value = null;
    invokeResult.data = { success: true };
    invokeResult.error = null;
  });

  it("labels a successful send as 'connected', distinct from delivered", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Send Test Email/i }));

    await waitFor(() => expect(screen.getByText(/Connected and logged in/i)).toBeInTheDocument());
    // The distinct, weaker claim must be visible too — this is the whole point.
    expect(screen.getByText(/not the same as delivered/i)).toBeInTheDocument();
    expect(screen.getByText(/Did the test email actually arrive/i)).toBeInTheDocument();
  });

  it("does not show 'connected' when the send itself fails", async () => {
    invokeResult.data = null;
    invokeResult.error = { message: "535: Incorrect authentication data" };

    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Send Test Email/i }));

    await waitFor(() => expect(screen.queryByText(/Connected and logged in/i)).not.toBeInTheDocument());
  });

  it("never offers the delivery-check shortcut from a bare send success", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Send Test Email/i }));

    await waitFor(() => expect(screen.getByText(/Connected and logged in/i)).toBeInTheDocument());
    expect(screen.queryByText(/Turn on the automatic delivery check/i)).not.toBeInTheDocument();
  });

  it("offers the delivery-check shortcut only after a confirmed delivery", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Send Test Email/i }));
    await waitFor(() => expect(screen.getByText(/Did the test email actually arrive/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Yes, it arrived/i }));

    await waitFor(() => expect(screen.getByText(/Turn on the automatic delivery check/i)).toBeInTheDocument());
    // The false-alarm caveat must be visible right there, not hidden behind another click.
    expect(screen.getByText(/hourly false alarm, not a real one/i)).toBeInTheDocument();
  });

  it("turning it on calls the same RPC Background Jobs uses, with the right job name", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Send Test Email/i }));
    await waitFor(() => screen.getByRole("button", { name: /Yes, it arrived/i }));
    fireEvent.click(screen.getByRole("button", { name: /Yes, it arrived/i }));
    await waitFor(() => screen.getByRole("button", { name: /Turn on delivery check/i }));

    fireEvent.click(screen.getByRole("button", { name: /Turn on delivery check/i }));

    await waitFor(() => {
      expect(rpcCalls.some((c) => c.fn === "admin_toggle_cron_job")).toBe(true);
    });
    const call = rpcCalls.find((c) => c.fn === "admin_toggle_cron_job")!;
    expect(call.args).toEqual({ p_jobname: "email-canary-check", p_enable: true });

    // The offer clears once acted on.
    await waitFor(() =>
      expect(screen.queryByText(/Turn on the automatic delivery check/i)).not.toBeInTheDocument(),
    );
  });

  it("'Not now' dismisses the offer without calling the RPC", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Send Test Email/i }));
    await waitFor(() => screen.getByRole("button", { name: /Yes, it arrived/i }));
    fireEvent.click(screen.getByRole("button", { name: /Yes, it arrived/i }));
    await waitFor(() => screen.getByRole("button", { name: /Not now/i }));

    fireEvent.click(screen.getByRole("button", { name: /Not now/i }));

    expect(screen.queryByText(/Turn on the automatic delivery check/i)).not.toBeInTheDocument();
    expect(rpcCalls.some((c) => c.fn === "admin_toggle_cron_job")).toBe(false);
  });

  it("a fresh test attempt clears a stale offer from a previous confirmation", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Send Test Email/i }));
    await waitFor(() => screen.getByRole("button", { name: /Yes, it arrived/i }));
    fireEvent.click(screen.getByRole("button", { name: /Yes, it arrived/i }));
    await waitFor(() => expect(screen.getByText(/Turn on the automatic delivery check/i)).toBeInTheDocument());

    // Starting a new test should not leave a stale offer from the last one hanging around.
    fireEvent.click(screen.getByRole("button", { name: /Send Test Email/i }));
    await waitFor(() =>
      expect(screen.queryByText(/Turn on the automatic delivery check/i)).not.toBeInTheDocument(),
    );
  });
});
