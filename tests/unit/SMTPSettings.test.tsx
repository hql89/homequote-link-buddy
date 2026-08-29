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
const upsertCalls: Record<string, unknown>[] = [];
const invokeResult: { data: unknown; error: unknown } = { data: { success: true }, error: null };
const rpcError: { value: { message: string } | null } = { value: null };
const rpcData: { value: unknown } = { value: null };

vi.mock("../../src/integrations/supabase/client", () => {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    upsert: (payload: Record<string, unknown>) => {
      upsertCalls.push(payload);
      return Promise.resolve({ error: null });
    },
  };
  return {
    supabase: {
      from: () => builder,
      functions: { invoke: () => Promise.resolve(invokeResult) },
      rpc: (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return Promise.resolve({ data: rpcData.value, error: rpcError.value });
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
  fromEmail: "admin@homequotelink.com",
  fromName: "Home Quote Link",
  adminNotificationEmail: "dgarcia89@gmail.com",
  enabled: true,
  // Only the masked tail ever reaches this component — see the write-only
  // suite at the bottom of this file.
  smtpPasswordHint: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022word",
};

function renderPanel() {
  const addLog = vi.fn();
  render(<SMTPSettings config={baseConfig} setConfig={() => {}} addLog={addLog} />);
  return { addLog };
}

describe("SMTPSettings — test/confirm/canary flow", () => {
  beforeEach(() => {
    rpcCalls.length = 0;
    upsertCalls.length = 0;
    rpcError.value = null;
    rpcData.value = null;
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
    expect(screen.getByText(/daily false alarm, not a real one/i)).toBeInTheDocument();
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

/**
 * The SMTP password used to be bound straight to the config blob: it was read
 * out of admin_settings into React state, rendered into an input, and offered
 * a reveal toggle. That put the live mail credential into every screenshot and
 * devtools dump of this screen, and wrote it back on every save.
 *
 * It now lives in Supabase Vault. These assertions are the same ones
 * PerplexitySettings.test.tsx makes for the Perplexity key, for the same
 * reason: the value must never reach the browser, and the form must never be
 * able to put it back into admin_settings.
 */
describe("SMTPSettings — the password is write-only", () => {
  beforeEach(() => {
    rpcCalls.length = 0;
    upsertCalls.length = 0;
    rpcError.value = null;
    rpcData.value = null;
  });

  const SECRET = "correct-horse-battery-staple";

  it("shows only a masked hint for the stored password", () => {
    const { container } = render(
      <SMTPSettings config={baseConfig} setConfig={() => {}} addLog={vi.fn()} />,
    );

    expect(screen.getByText(/Password stored/i)).toBeInTheDocument();
    expect(screen.getByText("••••••••word")).toBeInTheDocument();
    // Nothing resembling a real password may be in the DOM.
    expect(container.innerHTML).not.toContain(SECRET);
  });

  it("reports when no password is configured", () => {
    const { smtpPasswordHint: _none, ...withoutHint } = baseConfig;
    render(<SMTPSettings config={withoutHint} setConfig={() => {}} addLog={vi.fn()} />);

    expect(screen.getByText(/No password configured/i)).toBeInTheDocument();
  });

  it("leaves the password input empty, masked, and unable to reveal anything", () => {
    render(<SMTPSettings config={baseConfig} setConfig={() => {}} addLog={vi.fn()} />);

    const input = screen.getByLabelText(/SMTP Password/i) as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.type).toBe("password");
    // The old eye/eye-off toggle is gone — there is nothing left to reveal.
    expect(screen.queryByRole("button", { name: /show password/i })).not.toBeInTheDocument();
  });

  it("saves a new password through the Vault RPC, never into admin_settings", async () => {
    rpcData.value = "••••••••aple";
    const setConfig = vi.fn();
    render(<SMTPSettings config={baseConfig} setConfig={setConfig} addLog={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/SMTP Password/i), { target: { value: SECRET } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => expect(rpcCalls).toHaveLength(1));
    expect(rpcCalls[0].fn).toBe("admin_set_smtp_password");
    expect(rpcCalls[0].args).toEqual({ p_password: SECRET });

    // The critical negative: the password must not have been written to the
    // settings row by this path.
    expect(upsertCalls).toHaveLength(0);
  });

  it("clears the input after saving, so the password does not linger in the form", async () => {
    rpcData.value = "••••••••aple";
    render(<SMTPSettings config={baseConfig} setConfig={() => {}} addLog={vi.fn()} />);

    const input = screen.getByLabelText(/SMTP Password/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: SECRET } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => expect(input.value).toBe(""));
  });

  it("never writes a smtpPassword key when saving the other settings", async () => {
    render(<SMTPSettings config={baseConfig} setConfig={() => {}} addLog={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Save Settings/i }));

    await waitFor(() => expect(upsertCalls).toHaveLength(1));
    const written = upsertCalls[0].setting_value as Record<string, unknown>;
    expect(written).not.toHaveProperty("smtpPassword");
    expect(written.smtpHost).toBe("sv20.byethost20.org");
  });

  it("does not send the password anywhere when the save fails", async () => {
    rpcError.value = { message: "Forbidden" };
    const addLog = vi.fn();
    render(<SMTPSettings config={baseConfig} setConfig={() => {}} addLog={addLog} />);

    fireEvent.change(screen.getByLabelText(/SMTP Password/i), { target: { value: SECRET } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() =>
      expect(addLog).toHaveBeenCalledWith("error", expect.stringMatching(/Forbidden/)),
    );
    // A failed save must not leave the value in admin_settings as a consolation.
    expect(upsertCalls).toHaveLength(0);
  });
});
