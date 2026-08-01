import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logEmailSend } from "../../supabase/functions/_shared/emailLog";

/**
 * The failure this guards against: on 2026-07-25 four real emails went out,
 * were recorded only as business_id/lead_id, and those rows were later
 * hard-deleted — making the recipients unrecoverable. The property that
 * matters is that the literal address is stored, and that a reference to a
 * row which no longer exists never prevents or invalidates the record.
 */

type Captured = { table: string; row: Record<string, unknown> };

function fakeClient(behaviour: { error?: { message: string }; throws?: boolean } = {}) {
  const captured: Captured[] = [];
  const client = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          if (behaviour.throws) throw new Error("connection lost");
          captured.push({ table, row });
          return Promise.resolve({ error: behaviour.error ?? null });
        },
      };
    },
  };
  // logEmailSend only ever calls .from().insert(), so this stands in for the
  // real client without pulling in the Deno-only supabase-js import.
  return { client: client as never, captured };
}

const baseEntry = {
  jobName: "submit-directory-lead",
  emailType: "quote_request",
  recipientEmail: "owner@luxairhvac.com",
  recipientKind: "business",
  subject: "New quote request for Lux Air HVAC",
  status: "sent" as const,
  method: "smtp",
};

describe("logEmailSend", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes the literal recipient address, not a reference to it", async () => {
    const { client, captured } = fakeClient();
    await logEmailSend(client, baseEntry);

    expect(captured).toHaveLength(1);
    expect(captured[0].table).toBe("email_send_log");
    expect(captured[0].row.recipient_email).toBe("owner@luxairhvac.com");
  });

  it("still records the address when the related business no longer exists", async () => {
    // The 2026-07-25 regression, in miniature: the id is dangling, but the
    // row is written anyway and the address survives.
    const { client, captured } = fakeClient();
    await logEmailSend(client, {
      ...baseEntry,
      relatedBusinessId: "a807162d-b83a-4429-a6ee-2f9cec099f33", // deleted row
      relatedLeadId: "c93e9cb5-1ce7-4814-ab77-815a3d01b850", // deleted row
    });

    expect(captured[0].row.recipient_email).toBe("owner@luxairhvac.com");
    expect(captured[0].row.related_business_id).toBe("a807162d-b83a-4429-a6ee-2f9cec099f33");
  });

  it("records failed sends, not just successful ones", async () => {
    const { client, captured } = fakeClient();
    await logEmailSend(client, {
      ...baseEntry,
      status: "failed",
      method: "none",
      errorMessage: "SMTP: suspended | Resend: no key",
    });

    expect(captured[0].row.status).toBe("failed");
    expect(captured[0].row.error_message).toBe("SMTP: suspended | Resend: no key");
  });

  it("never throws when the insert fails — a lost log must not abort a send", async () => {
    const { client } = fakeClient({ error: { message: "permission denied" } });
    await expect(logEmailSend(client, baseEntry)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it("never throws when the client itself blows up mid-batch", async () => {
    const { client } = fakeClient({ throws: true });
    await expect(logEmailSend(client, baseEntry)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it("records a missing recipient rather than silently dropping the row", async () => {
    // "We sent something to nobody" is itself worth being able to see.
    const { client, captured } = fakeClient();
    await logEmailSend(client, { ...baseEntry, recipientEmail: "   " });

    expect(captured).toHaveLength(1);
    expect(captured[0].row.recipient_email).toBe("(unknown)");
  });

  it("caps oversized fields so one bad error can't bloat the table", async () => {
    const { client, captured } = fakeClient();
    await logEmailSend(client, {
      ...baseEntry,
      subject: "s".repeat(900),
      status: "failed",
      errorMessage: "e".repeat(5000),
    });

    expect((captured[0].row.subject as string).length).toBe(500);
    expect((captured[0].row.error_message as string).length).toBe(1000);
  });

  it("normalises absent optional fields to null rather than undefined", async () => {
    // undefined would be dropped from the JSON body and silently omitted.
    const { client, captured } = fakeClient();
    await logEmailSend(client, {
      jobName: "notify-admin-email",
      emailType: "test",
      recipientEmail: "dgarcia89@gmail.com",
      status: "sent",
    });

    const row = captured[0].row;
    expect(row.recipient_kind).toBeNull();
    expect(row.related_business_id).toBeNull();
    expect(row.related_lead_id).toBeNull();
    expect(row.error_message).toBeNull();
    expect(row.subject).toBeNull();
  });
});
