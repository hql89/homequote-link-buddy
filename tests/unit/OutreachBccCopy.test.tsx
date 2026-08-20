import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "../../src/components/ui/tooltip";

/**
 * The "send me a copy" BCC on /admin/outreach.
 *
 * What actually needs protecting here is the WRITE PAYLOAD, not the styling.
 * `outreach_config` is a single jsonb row shared by three writers: this field,
 * the daily limit, and `delivery_verified_at` — which the SMTP settings page
 * writes and which send-outreach-drip treats as the master gate. Overwriting
 * that row instead of merging into it silently halts ALL outreach with no
 * error anywhere, so the merge is pinned here.
 *
 * The self-address refusal is duplicated from `resolveBccCopy` (unit-tested in
 * emailSafety.test.ts, which is the real enforcement). This asserts only that
 * the UI stops it early rather than saving a value the server will later drop.
 */

const stored: { outreach: Record<string, unknown>; identity: Record<string, string> } = {
  outreach: {},
  identity: {},
};
const upserts: { setting_key: string; setting_value: Record<string, unknown> }[] = [];
const toastCalls: { title?: string; variant?: string }[] = [];

vi.mock("../../src/integrations/supabase/client", () => {
  function builder(table: string) {
    let settingKey = "";
    let selectStr = "";
    const b = {
      select: (s: string) => {
        selectStr = s;
        return b;
      },
      eq: (_col: string, val: string) => {
        settingKey = val;
        return b;
      },
      limit: () => b,
      // The readiness panel adds head/count queries against `businesses` and
      // `outreach_sends`; without these the chain breaks and the page never
      // finishes loading, hiding the real failure behind "element not found".
      is: () => b,
      not: () => b,
      gte: () => b,
      // loadOutreachVariants (real, not mocked — it runs against this same
      // client) awaits the builder directly after .order(), with no
      // .maybeSingle() to terminate the chain.
      order: () => b,
      then: (resolve: (v: { data: unknown[]; count: number; error: null }) => unknown) =>
        resolve({ data: [], count: 0, error: null }),
      maybeSingle: () => {
        if (table === "admin_settings" && settingKey === "smtp_config") {
          // Mirrors the `alias:setting_value->>key` projection the page uses so
          // the SMTP password is never selected into the browser at all.
          return Promise.resolve({ data: selectStr.includes("->>") ? stored.identity : null, error: null });
        }
        if (table === "admin_settings") {
          return Promise.resolve({ data: { setting_value: stored.outreach }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      upsert: (row: { setting_key: string; setting_value: Record<string, unknown> }) => {
        upserts.push(row);
        return Promise.resolve({ error: null });
      },
    };
    return b;
  }
  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: () => Promise.resolve({ data: [], error: null }),
      functions: { invoke: () => Promise.resolve({ data: {}, error: null }) },
    },
  };
});

vi.mock("../../src/hooks/use-toast", () => ({
  toast: (args: { title?: string; variant?: string }) => {
    toastCalls.push(args);
  },
}));

// AdminLayout's chrome (nav, sign-out, badge counts) is irrelevant here and
// would otherwise drag real auth and a counts query into every test.
vi.mock("../../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { email: "admin@example.com" }, signOut: vi.fn() }),
}));
vi.mock("../../src/hooks/useAdminCounts", () => ({
  useAdminCounts: () => ({ data: {} }),
}));

const OutreachPage = (await import("../../src/pages/admin/Outreach")).default;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TooltipProvider>
          <OutreachPage />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Outreach — send me a copy (BCC)", () => {
  beforeEach(() => {
    upserts.length = 0;
    toastCalls.length = 0;
    stored.outreach = { daily_limit: 10, delivery_verified_at: "2026-08-08T16:00:09.285Z" };
    stored.identity = { from_email: "admin@homequotelink.com", smtp_username: "admin@homequotelink.com" };
  });

  /**
   * Renders the page and waits for the field to appear. Queried by placeholder
   * rather than label: the label contains a HelpTip, and Radix's tooltip
   * duplicates that trigger text into the a11y tree, so getByLabelText matches
   * twice.
   */
  async function bccInput() {
    renderPage();
    const el = await waitFor(() => screen.getByPlaceholderText(/empty to turn off/i));
    return el as HTMLInputElement;
  }

  it("is empty, and shows no banner, when copies are off", async () => {
    expect((await bccInput()).value).toBe("");
    expect(screen.queryByText(/Copies are on/i)).not.toBeInTheDocument();
  });

  it("shows a persistent banner naming the address when copies are on", async () => {
    stored.outreach = { ...stored.outreach, bcc_email: "dgarcia89@gmail.com" };
    renderPage();
    await waitFor(() => expect(screen.getByText(/Copies are on/i)).toBeInTheDocument());
    expect(screen.getByText("dgarcia89@gmail.com")).toBeInTheDocument();
  });

  it("saving a copy address PRESERVES delivery_verified_at and daily_limit", async () => {
    // Clobbering delivery_verified_at would halt every future outreach run
    // with no error surfaced anywhere — the exact failure this merge prevents.
    const input = await bccInput();
    fireEvent.change(input, { target: { value: "dgarcia89@gmail.com" } });
    fireEvent.blur(input);

    await waitFor(() => expect(upserts).toHaveLength(1));
    expect(upserts[0].setting_value).toEqual({
      daily_limit: 10,
      delivery_verified_at: "2026-08-08T16:00:09.285Z",
      bcc_email: "dgarcia89@gmail.com",
    });
  });

  it("turning copies off REMOVES the key rather than storing an empty string", async () => {
    stored.outreach = { ...stored.outreach, bcc_email: "dgarcia89@gmail.com" };
    renderPage();
    const off = await waitFor(() => screen.getByRole("button", { name: /Turn off/i }));
    fireEvent.click(off);

    await waitFor(() => expect(upserts).toHaveLength(1));
    expect(upserts[0].setting_value).not.toHaveProperty("bcc_email");
    expect(upserts[0].setting_value).toHaveProperty("delivery_verified_at");
  });

  it("refuses the sending address, and writes nothing", async () => {
    const input = await bccInput();
    fireEvent.change(input, { target: { value: "admin@homequotelink.com" } });
    fireEvent.blur(input);

    await waitFor(() => expect(toastCalls.some((t) => t.variant === "destructive")).toBe(true));
    expect(upserts).toHaveLength(0);
    expect(toastCalls.at(-1)?.title).toMatch(/sending address/i);
  });

  it("refuses a malformed address, and writes nothing", async () => {
    const input = await bccInput();
    fireEvent.change(input, { target: { value: "not-an-email" } });
    fireEvent.blur(input);

    await waitFor(() => expect(toastCalls.some((t) => t.variant === "destructive")).toBe(true));
    expect(upserts).toHaveLength(0);
  });
});
