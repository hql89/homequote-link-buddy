import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";

/**
 * The property this locks in above all others: a failed alarm read must
 * render as an explicit error, never as "nothing to report". Silently
 * swallowing a broken read here would recreate, one layer up, the exact
 * invisibility this banner was built to close — an alarm gets recorded, and
 * now the failure to check for it goes unnoticed too.
 */

let alarmRows: { id: string; error_message: string | null; metadata: Record<string, unknown> | null; created_at: string }[] = [];
let alarmError: { message: string } | null = null;
let seenUpTo: string | null = null;
const upsertCalls: Record<string, unknown>[] = [];

vi.mock("../../src/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string) => {
      if (name === "admin_recent_alarms") {
        return Promise.resolve({ data: alarmError ? null : alarmRows, error: alarmError });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: seenUpTo ? { setting_value: { alarms_seen_up_to: seenUpTo } } : { setting_value: {} },
              error: null,
            }),
        }),
      }),
      upsert: (row: Record<string, unknown>) => {
        upsertCalls.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

const { AlarmBanner } = await import("../../src/components/admin/AlarmBanner");

beforeEach(() => {
  alarmRows = [];
  alarmError = null;
  seenUpTo = null;
  upsertCalls.length = 0;
});

describe("AlarmBanner", () => {
  it("renders nothing while it hasn't loaded, and nothing once loaded with no alarms", async () => {
    const { container } = render(<AlarmBanner />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeInTheDocument());
  });

  it("renders an alarm in plain language, not the raw kind or metadata blob", async () => {
    alarmRows = [
      {
        id: "a1",
        error_message: "Circuit breaker tripped: 260 emails in 10 minutes.",
        metadata: { alarm_kind: "email_circuit_breaker" },
        created_at: "2026-08-20T12:00:00Z",
      },
    ];
    render(<AlarmBanner />);

    await waitFor(() =>
      expect(screen.getByText("Outbound email was automatically disabled")).toBeInTheDocument(),
    );
    expect(screen.queryByText("email_circuit_breaker")).not.toBeInTheDocument();
  });

  it("shows an explicit error when the alarm read itself fails — never a silent all-clear", async () => {
    alarmError = { message: "permission denied for function admin_recent_alarms" };
    render(<AlarmBanner />);

    await waitFor(() => expect(screen.getByText(/Couldn't check for alerts/i)).toBeInTheDocument());
    expect(screen.getByText(/permission denied/)).toBeInTheDocument();
  });

  it("hides an alarm already dismissed on a prior visit", async () => {
    alarmRows = [
      {
        id: "a1",
        error_message: "old",
        metadata: { alarm_kind: "suppression_spike" },
        created_at: "2026-08-18T00:00:00Z",
      },
    ];
    seenUpTo = "2026-08-19T00:00:00Z";
    const { container } = render(<AlarmBanner />);

    await waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeInTheDocument());
  });

  it("re-shows the SAME alarm kind if it recurs after being dismissed — dismissal is not resolution", async () => {
    alarmRows = [
      {
        id: "a2",
        error_message: "new occurrence",
        metadata: { alarm_kind: "suppression_spike" },
        created_at: "2026-08-21T00:00:00Z",
      },
    ];
    seenUpTo = "2026-08-19T00:00:00Z"; // an earlier occurrence was already dismissed
    render(<AlarmBanner />);

    await waitFor(() =>
      expect(screen.getByText(/arriving far above the normal rate/)).toBeInTheDocument(),
    );
  });

  it("dismissing writes the newest alarm's timestamp, merged into admin_settings", async () => {
    alarmRows = [
      { id: "a1", error_message: "e1", metadata: { alarm_kind: "suppression_spike" }, created_at: "2026-08-20T10:00:00Z" },
      { id: "a2", error_message: "e2", metadata: { alarm_kind: "delivery_canary_failed" }, created_at: "2026-08-20T15:00:00Z" },
    ];
    render(<AlarmBanner />);

    await waitFor(() => expect(screen.getByText("2 alerts")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));

    await waitFor(() => expect(upsertCalls).toHaveLength(1));
    const written = upsertCalls[0].setting_value as { alarms_seen_up_to: string };
    expect(written.alarms_seen_up_to).toBe("2026-08-20T15:00:00Z");
  });

  it("clears the banner immediately after dismissing", async () => {
    alarmRows = [
      { id: "a1", error_message: "e1", metadata: { alarm_kind: "action_write_failed" }, created_at: "2026-08-20T10:00:00Z" },
    ];
    const { container } = render(<AlarmBanner />);

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));

    await waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeInTheDocument());
  });

  it("says plainly that dismissing hides the notice, not the problem", async () => {
    alarmRows = [
      { id: "a1", error_message: "e1", metadata: { alarm_kind: "delivery_canary_failed" }, created_at: "2026-08-20T10:00:00Z" },
    ];
    render(<AlarmBanner />);

    await waitFor(() => expect(screen.getByText(/hides this notice, not the problem/i)).toBeInTheDocument());
  });
});
