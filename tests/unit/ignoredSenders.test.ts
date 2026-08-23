import { describe, it, expect } from "vitest";
import {
  ruleMatches,
  findIgnoreRule,
  type IgnoredSenderRule,
} from "../../supabase/functions/_shared/ignoredSenders";

const domain = (pattern: string): IgnoredSenderRule => ({ match_type: "domain", pattern });
const address = (pattern: string): IgnoredSenderRule => ({ match_type: "address", pattern });

describe("ruleMatches — address rules", () => {
  it("matches the exact mailbox", () => {
    expect(ruleMatches("system@vercel.com", address("system@vercel.com"))).toBe(true);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(ruleMatches("  System@Vercel.COM ", address("system@vercel.com"))).toBe(true);
  });

  it("does not match a different mailbox on the same domain", () => {
    expect(ruleMatches("notifications@vercel.com", address("system@vercel.com"))).toBe(false);
  });
});

describe("ruleMatches — domain rules", () => {
  it("matches the domain itself", () => {
    expect(ruleMatches("system@vercel.com", domain("vercel.com"))).toBe(true);
  });

  it("matches a subdomain", () => {
    expect(ruleMatches("ship@info.vercel.com", domain("vercel.com"))).toBe(true);
  });

  /**
   * The reason the match is anchored on "@" or "." rather than a plain
   * suffix test. Without the anchor, one rule aimed at a vendor would also
   * quieten any lookalike domain — including one a contractor could
   * plausibly own.
   */
  it("does not match a lookalike domain", () => {
    expect(ruleMatches("owner@notvercel.com", domain("vercel.com"))).toBe(false);
  });

  it("does not match when the pattern appears only in the local part", () => {
    expect(ruleMatches("vercel.com@example.org", domain("vercel.com"))).toBe(false);
  });

  /**
   * A single-label pattern would match most of the internet. The database
   * function rejects these on the way in; this is the second line, because a
   * malformed row reaching the matcher must quieten nothing, not everything.
   */
  it("refuses a single-label pattern", () => {
    expect(ruleMatches("owner@luxairhvac.com", domain("com"))).toBe(false);
  });

  it("refuses an empty pattern rather than matching every address", () => {
    expect(ruleMatches("owner@luxairhvac.com", domain(""))).toBe(false);
    expect(ruleMatches("owner@luxairhvac.com", address(""))).toBe(false);
  });
});

describe("findIgnoreRule", () => {
  const rules = [domain("vercel.com"), domain("github.com"), address("welcome@supabase.com")];

  it("returns the rule that matched, so the reason is loggable", () => {
    expect(findIgnoreRule("ship@info.vercel.com", rules)).toEqual(domain("vercel.com"));
    expect(findIgnoreRule("welcome@supabase.com", rules)).toEqual(address("welcome@supabase.com"));
  });

  it("returns null for a contractor's address", () => {
    expect(findIgnoreRule("owner@luxairhvac.com", rules)).toBeNull();
  });

  it("returns null when there are no rules", () => {
    expect(findIgnoreRule("owner@luxairhvac.com", [])).toBeNull();
  });
});
