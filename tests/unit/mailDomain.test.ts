import { describe, it, expect, vi } from "vitest";
import { domainOf, checkMailDomain } from "../../supabase/functions/_shared/mailDomain";

/**
 * The property that matters most here is not "does it detect dead domains" —
 * it is that an INCONCLUSIVE answer is never mistaken for a dead domain.
 * Acting on this check writes `email_undeliverable_at`, which stops the
 * business's outreach and, since 2807d3b, its quote-request notifications too.
 * A DNS hiccup must never silence a real contractor's leads.
 */

const MX = 15, A = 1, AAAA = 28;

/** A fake resolver driven by a per-record-type script. */
function resolver(script: Partial<Record<"MX" | "A" | "AAAA", unknown>>) {
  return vi.fn(async (url: string) => {
    const type = new URL(url).searchParams.get("type") as "MX" | "A" | "AAAA";
    const entry = script[type];
    if (entry === undefined) throw new Error(`unexpected lookup: ${type}`);
    if (entry instanceof Error) throw entry;
    return { ok: true, json: async () => entry } as Response;
  });
}

const ok = (answer: { type: number; data: string }[]) => ({ Status: 0, Answer: answer });
const noData = { Status: 0, Answer: [] };
const nxdomain = { Status: 3 };

describe("domainOf", () => {
  it("extracts the domain, lowercased", () => {
    expect(domainOf("Info@Example.COM")).toBe("example.com");
    expect(domainOf("  a@b.co.uk  ")).toBe("b.co.uk");
  });

  it("takes the last @, so a quoted local part cannot smuggle one in", () => {
    expect(domainOf("weird@thing@real.com")).toBe("real.com");
  });

  it.each([
    ["empty", ""],
    ["null", null],
    ["undefined", undefined],
    ["no @", "nobody"],
    ["nothing before @", "@example.com"],
    ["nothing after @", "user@"],
    ["no TLD", "user@localhost"],
    ["trailing dot segment", "user@example."],
    ["space in domain", "user@exa mple.com"],
    ["underscore", "user@exa_mple.com"],
  ])("returns null for %s", (_label, input) => {
    // Null must mean "don't ask DNS", never "the domain is dead" — a
    // malformed address is a data problem, not proof of undeliverability.
    expect(domainOf(input as string)).toBeNull();
  });
});

describe("checkMailDomain", () => {
  it("accepts a domain with MX records", async () => {
    const result = await checkMailDomain("example.com", resolver({
      MX: ok([{ type: MX, data: "10 mail.example.com." }]),
    }));
    expect(result).toMatchObject({ acceptsMail: true, conclusive: true });
  });

  it("rejects NXDOMAIN conclusively", async () => {
    const result = await checkMailDomain("gone.example", resolver({ MX: nxdomain }));
    expect(result).toMatchObject({ acceptsMail: false, conclusive: true });
    expect(result.reason).toMatch(/NXDOMAIN/);
  });

  it("rejects a null MX, which declares the domain accepts no mail", async () => {
    const result = await checkMailDomain("nomail.example", resolver({
      MX: ok([{ type: MX, data: "0 ." }]),
    }));
    expect(result).toMatchObject({ acceptsMail: false, conclusive: true });
    expect(result.reason).toMatch(/null MX/);
  });

  it("does not mistake a real MX for a null MX", async () => {
    const result = await checkMailDomain("example.com", resolver({
      MX: ok([{ type: MX, data: "0 aspmx.l.google.com." }]),
    }));
    expect(result.acceptsMail).toBe(true);
  });

  it("falls back to the A record when there is no MX (RFC 5321 implicit MX)", async () => {
    // Small business domains often never configured an MX. Treating that as
    // fatal would wrongly condemn exactly this project's target audience.
    const result = await checkMailDomain("plain.example", resolver({
      MX: noData,
      A: ok([{ type: A, data: "203.0.113.10" }]),
    }));
    expect(result).toMatchObject({ acceptsMail: true, conclusive: true });
    expect(result.reason).toMatch(/implicit MX/);
  });

  it("falls back to AAAA when there is neither MX nor A", async () => {
    const result = await checkMailDomain("v6.example", resolver({
      MX: noData,
      A: noData,
      AAAA: ok([{ type: AAAA, data: "2001:db8::1" }]),
    }));
    expect(result).toMatchObject({ acceptsMail: true, conclusive: true });
  });

  it("rejects conclusively when there is no MX, A or AAAA", async () => {
    const result = await checkMailDomain("empty.example", resolver({
      MX: noData, A: noData, AAAA: noData,
    }));
    expect(result).toMatchObject({ acceptsMail: false, conclusive: true });
  });

  // ── Inconclusive paths: none of these may ever be acted on ───────────────

  it("is inconclusive when the lookup throws", async () => {
    const result = await checkMailDomain("example.com", resolver({ MX: new Error("network down") }));
    expect(result).toMatchObject({ acceptsMail: false, conclusive: false });
  });

  it("is inconclusive on a non-200 from the resolver", async () => {
    const result = await checkMailDomain("example.com", vi.fn(async () => ({ ok: false }) as Response));
    expect(result.conclusive).toBe(false);
  });

  it("is inconclusive on a malformed body", async () => {
    const result = await checkMailDomain("example.com", vi.fn(async () => ({
      ok: true, json: async () => ({ nonsense: true }),
    }) as unknown as Response));
    expect(result.conclusive).toBe(false);
  });

  it("is inconclusive on unparseable JSON", async () => {
    const result = await checkMailDomain("example.com", vi.fn(async () => ({
      ok: true, json: async () => { throw new Error("not json"); },
    }) as unknown as Response));
    expect(result.conclusive).toBe(false);
  });

  it("is inconclusive on SERVFAIL rather than calling the domain dead", async () => {
    const result = await checkMailDomain("example.com", resolver({ MX: { Status: 2 } }));
    expect(result).toMatchObject({ acceptsMail: false, conclusive: false });
  });

  it("is inconclusive when the A fallback itself fails", async () => {
    // The dangerous shape: MX answered cleanly with nothing, so we are one
    // failed lookup away from wrongly concluding the domain is dead.
    const result = await checkMailDomain("example.com", resolver({
      MX: noData,
      A: new Error("timeout"),
    }));
    expect(result).toMatchObject({ acceptsMail: false, conclusive: false });
  });

  it("never reports acceptsMail=false with conclusive=true unless DNS said so", async () => {
    const inconclusive = [
      await checkMailDomain("a.example", resolver({ MX: new Error("x") })),
      await checkMailDomain("b.example", resolver({ MX: { Status: 2 } })),
      await checkMailDomain("c.example", resolver({ MX: noData, A: new Error("x") })),
    ];
    for (const result of inconclusive) {
      expect(result.conclusive).toBe(false);
    }
  });
});
