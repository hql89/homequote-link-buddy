import { describe, it, expect } from "vitest";
import {
  extractEmail,
  extractName,
  classifyReply,
} from "../../supabase/functions/_shared/inboundClassifier";

describe("extractEmail", () => {
  it("extracts from a Name <addr> header", () => {
    expect(extractEmail("Lux Air HVAC <owner@luxairhvac.com>")).toBe("owner@luxairhvac.com");
  });

  it("lower-cases for case-insensitive matching against businesses.email", () => {
    expect(extractEmail("Owner <Owner@LuxAirHVAC.com>")).toBe("owner@luxairhvac.com");
  });

  it("extracts a bare address with no display name", () => {
    expect(extractEmail("owner@luxairhvac.com")).toBe("owner@luxairhvac.com");
  });

  it("falls back to the trimmed raw input when nothing matches", () => {
    expect(extractEmail("not an email at all")).toBe("not an email at all");
  });
});

describe("extractName", () => {
  it("extracts the display name", () => {
    expect(extractName("Lux Air HVAC <owner@luxairhvac.com>")).toBe("Lux Air HVAC");
  });

  it("strips surrounding quotes", () => {
    expect(extractName('"Lux Air HVAC" <owner@luxairhvac.com>')).toBe("Lux Air HVAC");
  });

  it("falls back to a generic label for a bare address", () => {
    expect(extractName("owner@luxairhvac.com")).toBe("Unknown sender");
  });
});

describe("classifyReply — unsubscribe", () => {
  it.each([
    "STOP",
    "please unsubscribe me",
    "remove me from this list",
    "opt out please",
    "opt-out",
    "take me off this list",
  ])("classifies %j as unsubscribe", (body) => {
    expect(classifyReply(body).classification).toBe("unsubscribe");
  });

  it("wins over a YES in the same message — the asymmetry is deliberate", () => {
    const result = classifyReply("Yes that's correct, but please unsubscribe me anyway, stop emailing.");
    expect(result.classification).toBe("unsubscribe");
  });

  it("does not extract a URL even if one is present in an unsubscribe message", () => {
    const result = classifyReply("STOP. Also see https://example.com for reference.");
    expect(result.classification).toBe("unsubscribe");
    expect(result.extractedUrl).toBeNull();
  });
});

describe("classifyReply — confirm", () => {
  it.each(["YES", "Yes, that's correct", "yes that's right"])(
    "classifies %j as confirm",
    (body) => {
      expect(classifyReply(body).classification).toBe("confirm");
    },
  );

  it("does not match 'yes' appearing deep in a long reply", () => {
    const body =
      "Thanks for reaching out. ".repeat(10) +
      "Let me know if that works, yes? I'm not sure about the phone number though.";
    expect(classifyReply(body).classification).not.toBe("confirm");
  });
});

describe("classifyReply — website", () => {
  it("extracts an https URL", () => {
    const result = classifyReply("Sure, here it is: https://luxairhvac.com");
    expect(result.classification).toBe("website");
    expect(result.extractedUrl).toBe("https://luxairhvac.com");
  });

  it("extracts a bare www. URL and adds a scheme", () => {
    const result = classifyReply("www.luxairhvac.com is our site");
    expect(result.classification).toBe("website");
    expect(result.extractedUrl).toBe("https://www.luxairhvac.com");
  });

  it("only matches when no unsubscribe or confirm signal is present", () => {
    const result = classifyReply("Yes! Here's our site: https://luxairhvac.com");
    expect(result.classification).toBe("confirm");
  });

  it("strips trailing sentence punctuation rather than including it in the URL", () => {
    expect(classifyReply("Our site is www.testinboundco.com, thanks!").extractedUrl).toBe(
      "https://www.testinboundco.com",
    );
    expect(classifyReply("Check out https://example.com.").extractedUrl).toBe("https://example.com");
    expect(classifyReply("It's https://example.com/page?").extractedUrl).toBe(
      "https://example.com/page",
    );
  });

  it("keeps a meaningful path or query string intact", () => {
    expect(classifyReply("here: https://example.com/services?id=42").extractedUrl).toBe(
      "https://example.com/services?id=42",
    );
  });
});

describe("classifyReply — unclassified", () => {
  it("falls back for plain prose matching nothing", () => {
    expect(classifyReply("Thanks for the email, I'll think about it.").classification).toBe(
      "unclassified",
    );
  });

  it("does not throw on an empty body", () => {
    expect(() => classifyReply("")).not.toThrow();
    expect(classifyReply("").classification).toBe("unclassified");
  });
});

describe("classifyReply — isPriority (sort hint, never an action)", () => {
  it.each([
    "How much does this cost?",
    "I'm interested, can you call me?",
    "What's the price for the featured listing?",
  ])("flags %j as priority", (body) => {
    expect(classifyReply(body).isPriority).toBe(true);
  });

  it("is false for routine unsubscribe/confirm noise", () => {
    expect(classifyReply("STOP").isPriority).toBe(false);
    expect(classifyReply("Yes that's correct").isPriority).toBe(false);
  });

  it("applies independently of classification — a priority unsubscribe is still classified unsubscribe", () => {
    const result = classifyReply("STOP — and what does this cost anyway?");
    expect(result.classification).toBe("unsubscribe");
    expect(result.isPriority).toBe(true);
  });
});
