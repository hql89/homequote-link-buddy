import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";

/**
 * What this page is for: seeing and changing what real cold emails say before
 * any of them go out. So the properties that matter are that it shows the
 * copy that will actually be sent, that edits reach the table the send job
 * reads from, and — above all — that it never quietly implies an email will
 * send when it won't. A stage with no active variant is skipped entirely by
 * send-outreach-drip; the page has to say so rather than looking normal.
 */

const variantRows = [
  {
    id: "v-verify-a",
    email_type: "outreach_verify",
    variant_key: "A",
    subject: "Quick question about {{business_name}} in {{city}}",
    body: "Hi {{owner_name}},\n\nIs {{phone}} right?\n\nBest,\n{{sender_name}}",
    weight: 1,
    is_active: true,
    created_at: "2026-08-14T00:00:00Z",
    updated_at: "2026-08-14T00:00:00Z",
  },
  {
    id: "v-preview-a",
    email_type: "outreach_preview",
    variant_key: "A",
    subject: "Your {{city}} listing is ready",
    body: "Hi {{owner_name}},\n\n{{claim_url}}\n\nBest,\n{{sender_name}}",
    weight: 1,
    is_active: true,
    created_at: "2026-08-14T00:00:00Z",
    updated_at: "2026-08-14T00:00:00Z",
  },
];

const statsRows = [
  {
    email_type: "outreach_verify",
    variant_key: "A",
    sent_count: 8,
    replied_count: 3,
    claimed_count: 0,
    last_sent_at: "2026-08-13T00:00:00Z",
  },
];

let variants = [...variantRows];
let statsError: { message: string } | null = null;
const saveCalls: { id: string; values: Record<string, unknown> }[] = [];
const upsertCalls: Record<string, unknown>[] = [];
const invokeCalls: string[] = [];
let invokeResult: { data: unknown; error: unknown } = { data: { success: true }, error: null };

vi.mock("../../src/integrations/supabase/client", () => {
  // A permissive chain builder rather than a fixed nesting of objects. The
  // page issues several differently-shaped queries against `businesses`
  // alone — a single-row sample ending in .maybeSingle(), and head/count
  // queries ending in an await — and a rigid mock silently fails to resolve
  // one of them, leaving the page stuck loading and every assertion reporting
  // a missing element instead of the real cause.
  function builder(table: string) {
    let single = false;
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "not", "gte", "lte", "order", "in"]) {
      b[m] = () => b;
    }
    b.limit = () => {
      single = true;
      return b;
    };
    b.maybeSingle = () => {
      if (table === "admin_settings") {
        return Promise.resolve({
          data: { setting_value: { daily_limit: 10, delivery_verified_at: "2026-08-19T12:00:00Z" } },
          error: null,
        });
      }
      return Promise.resolve({
        data: {
          business_name: "Valley Roofing Co",
          city: "Van Nuys",
          owner_name: "Dana",
          phone: "(818) 555-0142",
        },
        error: null,
      });
    };
    // Terminal await for the head/count queries behind the readiness panel.
    b.then = (resolve: (v: { data: unknown[]; count: number; error: null }) => unknown) =>
      resolve({ data: [], count: single ? 1 : 5, error: null });
    b.upsert = (v: Record<string, unknown>) => {
      upsertCalls.push(v);
      return Promise.resolve({ error: null });
    };
    return b;
  }

  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: (name: string) => {
        if (name === "admin_outreach_variant_stats") {
          return Promise.resolve({ data: statsError ? null : statsRows, error: statsError });
        }
        if (name === "admin_list_cron_jobs") {
          return Promise.resolve({
            data: [{ jobname: "send-outreach-drip-daily", active: false }],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      },
      functions: {
        invoke: (name: string) => {
          invokeCalls.push(name);
          return Promise.resolve(invokeResult);
        },
      },
    },
  };
});

vi.mock("../../src/hooks/use-toast", () => ({ toast: vi.fn() }));

vi.mock("../../src/components/admin/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: unknown }) => children,
}));

vi.mock("../../src/integrations/supabase/directory", () => ({
  loadOutreachVariants: () => Promise.resolve({ variants, error: null }),
  saveOutreachVariant: (id: string, values: Record<string, unknown>) => {
    saveCalls.push({ id, values });
    return Promise.resolve(null);
  },
  createOutreachVariant: () => Promise.resolve(null),
  deleteOutreachVariant: () => Promise.resolve(null),
}));

const { default: OutreachPage } = await import("../../src/pages/admin/Outreach");
const { TooltipProvider } = await import("../../src/components/ui/tooltip");
// The readiness panel links to the screens that fix each blocker, so the page
// now needs router context to render at all.
const { MemoryRouter } = await import("react-router-dom");

function renderPage() {
  return render(
    <MemoryRouter>
      <TooltipProvider delayDuration={0}>
        <OutreachPage />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  variants = variantRows.map((v) => ({ ...v }));
  statsError = null;
  saveCalls.length = 0;
  upsertCalls.length = 0;
  invokeCalls.length = 0;
  invokeResult = { data: { success: true }, error: null };
});

describe("OutreachPage", () => {
  it("shows both emails with their current copy", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText(/Email 1 — phone verification/)).toBeInTheDocument());
    expect(screen.getByText(/Email 2 — listing preview/)).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("Quick question about {{business_name}} in {{city}}"),
    ).toBeInTheDocument();
  });

  it("saves an edited subject through to the variant table", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByDisplayValue(/Quick question about/)).toBeInTheDocument());
    const subject = screen.getByDisplayValue(/Quick question about/);
    fireEvent.change(subject, { target: { value: "New subject line" } });

    const card = subject.closest("li")!;
    fireEvent.click(within(card).getByRole("button", { name: /save/i }));

    await waitFor(() => expect(saveCalls).toHaveLength(1));
    expect(saveCalls[0].id).toBe("v-verify-a");
    expect(saveCalls[0].values.subject).toBe("New subject line");
  });

  it("warns when Email 1 gains a link, without blocking the save", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByDisplayValue(/Quick question about/)).toBeInTheDocument());
    const card = screen.getByDisplayValue(/Quick question about/).closest("li")!;
    const body = within(card).getByLabelText("Message");
    fireEvent.change(body, { target: { value: "Check https://example.com" } });

    await waitFor(() =>
      expect(within(card).getByText(/looks like it contains a link/i)).toBeInTheDocument(),
    );
    // Still savable — testing a linked variant deliberately is allowed.
    expect(within(card).getByRole("button", { name: /save/i })).not.toBeDisabled();
  });

  it("does not warn about the claim link on Email 2, where it belongs", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByDisplayValue(/Your \{\{city\}\} listing/)).toBeInTheDocument());
    const card = screen.getByDisplayValue(/Your \{\{city\}\} listing/).closest("li")!;
    expect(within(card).queryByText(/looks like it contains a link/i)).not.toBeInTheDocument();
  });

  it("says plainly that an email with no active version will not send", async () => {
    variants = variantRows.map((v) =>
      v.email_type === "outreach_verify" ? { ...v, is_active: false } : { ...v },
    );
    renderPage();

    await waitFor(() => expect(screen.getByText(/None active — won't send/i)).toBeInTheDocument());
    expect(screen.getByText(/will not fall\s+back to older copy/i)).toBeInTheDocument();
  });

  it("saves the daily limit, clamping a nonsense value", async () => {
    // Queried by id: the label also wraps a HelpTip button, which is itself a
    // labelable element, so getByLabelText legitimately matches two things.
    const { container } = renderPage();

    await waitFor(() => expect(container.querySelector("#daily-limit")).toBeTruthy());
    const input = container.querySelector("#daily-limit")!;
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input, { target: { value: "0" } });

    await waitFor(() => expect(upsertCalls).toHaveLength(1));
    const value = upsertCalls[0].setting_value as Record<string, unknown>;
    // Clamped to the floor of 1 rather than written as 0, which would read as
    // "unlimited" to anyone glancing at the row.
    expect(value.daily_limit).toBe(1);
  });

  it("preserves other keys in outreach_config when saving the limit", async () => {
    const { container } = renderPage();

    await waitFor(() => expect(container.querySelector("#daily-limit")).toBeTruthy());
    const input = container.querySelector("#daily-limit")!;
    fireEvent.change(input, { target: { value: "25" } });
    fireEvent.blur(input, { target: { value: "25" } });

    await waitFor(() => expect(upsertCalls).toHaveLength(1));
    expect((upsertCalls[0].setting_value as Record<string, unknown>).daily_limit).toBe(25);
  });

  it("renders per-variant results when they load", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText(/8 sent · 3 replied/)).toBeInTheDocument());
  });

  it("reports unreadable results instead of showing them as zero", async () => {
    statsError = { message: "permission denied" };
    renderPage();

    await waitFor(() => expect(screen.getByText(/Couldn't load results/i)).toBeInTheDocument());
    expect(screen.queryByText(/8 sent/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Results unavailable/i).length).toBeGreaterThan(0);
  });

  it("previews the copy with a real business's details filled in", async () => {
    renderPage();

    // One preview block per variant, so scope to Email 1's card rather than
    // querying the page globally.
    await waitFor(() => expect(screen.getByDisplayValue(/Quick question about/)).toBeInTheDocument());
    const card = screen.getByDisplayValue(/Quick question about/).closest("li")!;
    fireEvent.click(within(card).getByText("Preview"));

    await waitFor(() =>
      expect(within(card).getByText(/Using Valley Roofing Co/)).toBeInTheDocument(),
    );
    expect(
      within(card).getByText("Quick question about Valley Roofing Co in Van Nuys"),
    ).toBeInTheDocument();
  });

  it("surfaces the reason when a run sends nothing", async () => {
    const { toast } = await import("../../src/hooks/use-toast");
    invokeResult = {
      data: { success: true, halted: "daily_limit_reached", reason: "10 of today's limit of 10 already sent." },
      error: null,
    };
    const { container } = renderPage();

    await waitFor(() => expect(container.querySelector("#daily-limit")).toBeTruthy());
    // Exact name: the page's HelpTip text mentions the "Run now" button, so a
    // regex would also match that tooltip trigger.
    fireEvent.click(within(container as HTMLElement).getByRole("button", { name: "Run now" }));

    await waitFor(() => expect(invokeCalls).toContain("send-outreach-drip"));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Nothing sent", description: expect.stringContaining("limit") }),
      ),
    );
  });
});
