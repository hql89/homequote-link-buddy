import { describe, it, expect } from "vitest";
import {
  extractEmail,
  extractName,
  classifyReply,
  isBounce,
  classifyBounce,
  extractBouncedRecipient,
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

/**
 * Fixture is the real bounce received on 2026-08-01 at 17:01 UTC, verbatim.
 * It is the exact case the outreach drip must survive: our own domain is
 * blocked, SMTP accepted the message anyway, and the failure only shows up
 * as a separate inbound email afterwards.
 */
const REAL_SUSPENSION_BOUNCE = `This message was created automatically by mail delivery software.

A message that you sent could not be delivered to one or more of its
recipients. This is a permanent error. The following address(es) failed:

  dgarcia89@gmail.com
    Domain homequotelink.com has an outgoing mail suspension.  Message discarded.

---------- Forwarded message ----------
From: Home Quote Link <admin@homequotelink.com>
To: <dgarcia89@gmail.com>
Subject: HomeQuoteLink — Test Email`;

describe("isBounce", () => {
  it("recognises the real suspension bounce", () => {
    expect(
      isBounce(
        "Mail Delivery System <MAILER-DAEMON@sv20.byethost20.org>",
        "Mail delivery failed: returning message to sender",
        REAL_SUSPENSION_BOUNCE,
      ),
    ).toBe(true);
  });

  it("recognises a bounce from any one signal alone", () => {
    expect(isBounce("MAILER-DAEMON@example.com", "", "")).toBe(true);
    expect(isBounce("", "Undelivered Mail Returned to Sender", "")).toBe(true);
    expect(isBounce("", "", "Your message could not be delivered.")).toBe(true);
  });

  it("does not treat a genuine reply as a bounce", () => {
    expect(isBounce("Dana <owner@luxairhvac.com>", "Re: Quick question", "Yes that's correct, thanks!"))
      .toBe(false);
    expect(isBounce("Dana <owner@luxairhvac.com>", "Re: Quick question", "Please remove me from your list"))
      .toBe(false);
  });
});

describe("classifyBounce", () => {
  it("classifies our own domain being suspended as sender-side, so it can be retried", () => {
    expect(classifyBounce(REAL_SUSPENSION_BOUNCE)).toBe("sender_blocked");
  });

  it("classifies a dead mailbox as recipient-side, so it is never retried", () => {
    expect(classifyBounce("550 5.1.1 <nobody@example.com>: Recipient address rejected: User unknown"))
      .toBe("recipient_invalid");
    expect(classifyBounce("The email account that you tried to reach does not exist."))
      .toBe("recipient_invalid");
  });

  it("prefers sender-side when a bounce shows both, so a good contact is not discarded", () => {
    // Our block is the real cause; recipient-shaped text is quoted noise.
    const mixed = "Domain homequotelink.com has an outgoing mail suspension. user unknown";
    expect(classifyBounce(mixed)).toBe("sender_blocked");
  });

  it("falls back to unknown rather than guessing", () => {
    expect(classifyBounce("Delivery failed for reasons we did not explain.")).toBe("unknown");
  });
});

describe("extractBouncedRecipient", () => {
  it("pulls the failed address out of the real bounce, not our own", () => {
    expect(extractBouncedRecipient(REAL_SUSPENSION_BOUNCE, "homequotelink.com"))
      .toBe("dgarcia89@gmail.com");
  });

  it("skips the daemon's own address", () => {
    const body = "From: MAILER-DAEMON@sv20.byethost20.org\nFailed: owner@luxairhvac.com";
    expect(extractBouncedRecipient(body, "homequotelink.com")).toBe("owner@luxairhvac.com");
  });

  it("returns null when no third-party address appears", () => {
    expect(extractBouncedRecipient("admin@homequotelink.com only", "homequotelink.com")).toBeNull();
    expect(extractBouncedRecipient("no addresses here", "homequotelink.com")).toBeNull();
  });
});

describe("classifyReply — bounces must not be mistaken for replies", () => {
  it("does not read a bounce quoting 'remove' as an unsubscribe", () => {
    // The pre-existing hazard this guards: bounce bodies quote the original
    // message and often contain 'remove'/'stop'. Suppressing a business on
    // the strength of a machine-generated failure notice would be wrong.
    const bounce = "Delivery failed. Please remove this address and try again.";
    expect(isBounce("MAILER-DAEMON@x.com", "Undeliverable", bounce)).toBe(true);
  });
});
