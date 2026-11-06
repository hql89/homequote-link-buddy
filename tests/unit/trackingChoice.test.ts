import { readFileSync } from "node:fs";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  TRACKING_CHOICE_KEY,
  readTrackingChoice,
  writeTrackingChoice,
  isTrackingOptedOut,
  optOutReason,
  hasGlobalPrivacyControl,
} from "../../src/lib/trackingChoice";

function setGpc(value: boolean | undefined) {
  Object.defineProperty(navigator, "globalPrivacyControl", {
    value,
    configurable: true,
  });
}

beforeEach(() => {
  localStorage.clear();
  setGpc(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("trackingChoice", () => {
  it("defaults to tracking allowed, matching the stated policy", () => {
    // There is no consent banner, and the policy says so. The control exists
    // to make "no" possible and durable, not to quietly change the default.
    expect(isTrackingOptedOut()).toBe(false);
    expect(readTrackingChoice()).toBe("unset");
    expect(optOutReason()).toBeNull();
  });

  it("remembers an explicit opt-out", () => {
    writeTrackingChoice("opted_out");
    expect(readTrackingChoice()).toBe("opted_out");
    expect(isTrackingOptedOut()).toBe(true);
    expect(optOutReason()).toBe("choice");
  });

  it("lets someone opt back in", () => {
    writeTrackingChoice("opted_out");
    writeTrackingChoice("opted_in");
    expect(isTrackingOptedOut()).toBe(false);
  });

  it("honours Global Privacy Control with no stored choice", () => {
    // California treats a GPC signal as a valid opt-out request in itself, so
    // offering only a toggle would answer the easy half.
    setGpc(true);
    expect(hasGlobalPrivacyControl()).toBe(true);
    expect(isTrackingOptedOut()).toBe(true);
    expect(optOutReason()).toBe("gpc");
  });

  it("lets a live GPC signal override an explicit opt-IN", () => {
    // The signal is the more recent statement of intent on every page load.
    writeTrackingChoice("opted_in");
    setGpc(true);
    expect(isTrackingOptedOut()).toBe(true);
    expect(optOutReason()).toBe("gpc");
  });

  it("never persists GPC, so turning it off restores the real choice", () => {
    setGpc(true);
    expect(isTrackingOptedOut()).toBe(true);
    expect(localStorage.getItem(TRACKING_CHOICE_KEY)).toBeNull();
    setGpc(false);
    expect(isTrackingOptedOut()).toBe(false);
  });

  it("treats a junk stored value as no choice rather than as an opt-out", () => {
    localStorage.setItem(TRACKING_CHOICE_KEY, "yes-please");
    expect(readTrackingChoice()).toBe("unset");
    expect(isTrackingOptedOut()).toBe(false);
  });

  it("does not throw when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => isTrackingOptedOut()).not.toThrow();
    expect(() => writeTrackingChoice("opted_out")).not.toThrow();
    expect(isTrackingOptedOut()).toBe(false);
  });

  it("still reports opted out from GPC when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    setGpc(true);
    expect(isTrackingOptedOut()).toBe(true);
  });

  /**
   * The inline guard at the top of index.html cannot import this module — it
   * must run before any bundle, which is the whole point. So the key and
   * values are duplicated there, and drift would silently stop the guard
   * matching while every test here still passed.
   */
  it("uses the exact key and value the index.html guard reads", () => {
    const html = readFileSync("index.html", "utf8");
    expect(TRACKING_CHOICE_KEY).toBe("hql_tracking_choice");
    expect(html).toContain(`localStorage.getItem('${TRACKING_CHOICE_KEY}')`);
    expect(html).toContain("'opted_out'");
    expect(html).toContain("navigator.globalPrivacyControl");
  });

  it("keeps the guard above both tracker snippets, or it runs too late", () => {
    // A check that runs after the snippets is a check that runs after
    // collection has already started.
    const html = readFileSync("index.html", "utf8");
    const guard = html.indexOf("__hqlTrackingOptedOut");
    const ga = html.indexOf("googletagmanager.com/gtag/js");
    const meta = html.indexOf("connect.facebook.net");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(ga);
    expect(guard).toBeLessThan(meta);
  });

  it("no longer ships the Meta noscript pixel, which no script could hold back", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).not.toContain("facebook.com/tr?id=");
  });
});
