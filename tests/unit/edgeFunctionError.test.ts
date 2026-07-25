import { describe, it, expect } from "vitest";
import { extractEdgeError } from "../../src/lib/edgeFunctionError";

describe("extractEdgeError", () => {
  it("uses the error from a 200 { success:false } body", async () => {
    const result = await extractEdgeError(null, { success: false, error: "Consent is required." }, "fallback");
    expect(result).toBe("Consent is required.");
  });

  it("reads the real message out of a non-2xx FunctionsHttpError", async () => {
    // supabase-js nulls `data` and attaches the Response as `context`.
    const error = {
      message: "Edge Function returned a non-2xx status code",
      context: new Response(JSON.stringify({ success: false, error: "That email does not match." }), {
        status: 403,
      }),
    };
    const result = await extractEdgeError(error, null, "fallback");
    expect(result).toBe("That email does not match.");
  });

  it("surfaces the rate-limit message so the cooldown is explained", async () => {
    const error = {
      message: "Edge Function returned a non-2xx status code",
      context: new Response(
        JSON.stringify({ success: false, error: "A demo call was just requested. Try again in 4 minute(s)." }),
        { status: 429 },
      ),
    };
    expect(await extractEdgeError(error, null, "fallback")).toMatch(/Try again in 4 minute/);
  });

  it("never leaks the generic non-2xx string to the user", async () => {
    const error = { message: "Edge Function returned a non-2xx status code" };
    expect(await extractEdgeError(error, null, "Could not claim this listing.")).toBe(
      "Could not claim this listing.",
    );
  });

  it("falls back when the response body is not JSON", async () => {
    const error = {
      message: "Edge Function returned a non-2xx status code",
      context: new Response("<html>502 Bad Gateway</html>", { status: 502 }),
    };
    expect(await extractEdgeError(error, null, "fallback")).toBe("fallback");
  });

  it("passes through a genuine network Error message", async () => {
    expect(await extractEdgeError(new Error("Failed to fetch"), null, "fallback")).toBe("Failed to fetch");
  });

  it("falls back when there is nothing usable at all", async () => {
    expect(await extractEdgeError(null, null, "fallback")).toBe("fallback");
  });
});
