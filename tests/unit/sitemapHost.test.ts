import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SITE_URL } from "../../src/lib/constants";

/**
 * The sitemap edge function runs in Deno and cannot import SITE_URL, so its host
 * is a separate literal. Two literals for one fact drift, and the drift is the
 * defect this guards: a sitemap listing apex URLs while every canonical said www
 * would tell Google the two hosts disagree about which page is real.
 */
describe("sitemap host matches the site's canonical host", () => {
  it("uses the same host as SITE_URL", () => {
    const src = readFileSync("supabase/functions/sitemap/index.ts", "utf8");
    const match = src.match(/const DEFAULT_DOMAIN = "([^"]+)"/);
    expect(match, "DEFAULT_DOMAIN literal not found — did it get renamed?").toBeTruthy();
    expect(match![1]).toBe(new URL(SITE_URL).host);
  });

  it("is the www host, which is the one that serves 200", () => {
    expect(new URL(SITE_URL).host).toBe("www.homequotelink.com");
  });
});
