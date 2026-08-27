import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * renderTemplate replaces an unrecognised {{placeholder}} with an empty string
 * rather than throwing:
 *
 *   template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => vars[key] ?? "")
 *
 * So a placeholder the sending stage doesn't build is not a build error and not
 * a runtime error — it is a blank space in an email already delivered to a real
 * business owner. The likeliest instance is {{claim_url}} in Email 1, which
 * reads perfectly well in a migration and does not exist until Email 2.
 *
 * These are the `vars` maps in send-outreach-drip/index.ts. Adding a key there
 * means adding it here too.
 */
const ALLOWED: Record<string, string[]> = {
  outreach_verify: ["business_name", "city", "owner_name", "phone", "sender_name", "unsubscribe_url"],
  outreach_preview: [
    "business_name",
    "city",
    "owner_name",
    "phone",
    "sender_name",
    "unsubscribe_url",
    "claim_url",
  ],
};

const MIGRATIONS_DIR = join(__dirname, "../../supabase/migrations");

interface SeededVariant {
  file: string;
  emailType: string;
  variantKey: string;
  placeholders: string[];
}

/**
 * Seeds are split per INSERT statement rather than scanned file-wide: an
 * `insert ... where not exists (select 1 ... where email_type = ...)` names its
 * email type twice, so a file-wide scan pairs the second mention with the next
 * statement's body and mis-attributes it.
 *
 * Two body-quoting styles are in use — E'...' in the original seed,
 * $body$...$body$ in the variant B seed — and both are read.
 */
function seededVariants(): SeededVariant[] {
  const found: SeededVariant[] = [];

  for (const file of readdirSync(MIGRATIONS_DIR).sort()) {
    if (!file.endsWith(".sql")) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");

    const statements = sql.split(/\binsert\s+into\s+public\.outreach_template_variants\b/i).slice(1);

    for (const statement of statements) {
      const header = statement.match(/'(outreach_verify|outreach_preview)'\s*,\s*'([A-Za-z0-9]+)'/);
      if (!header) continue;

      const body =
        statement.match(/\$body\$([\s\S]*?)\$body\$/)?.[1] ??
        statement.match(/\bE'((?:[^']|'')*)'/)?.[1];
      if (body === undefined) continue;

      found.push({
        file,
        emailType: header[1],
        variantKey: header[2],
        placeholders: [...body.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]),
      });
    }
  }
  return found;
}

describe("seeded outreach template placeholders", () => {
  const seeded = seededVariants();

  it("finds every seeded variant", () => {
    // Guards the parser: if the seeding style changes and this stops matching,
    // the suite must fail loudly rather than vacuously pass.
    const ids = seeded.map((s) => `${s.emailType}/${s.variantKey}`).sort();
    expect(ids).toEqual([
      "outreach_preview/A",
      "outreach_preview/B",
      "outreach_verify/A",
      "outreach_verify/B",
    ]);
  });

  it("uses only placeholders the sending stage actually builds", () => {
    const offenders = seeded.flatMap(({ file, emailType, variantKey, placeholders }) =>
      placeholders
        .filter((p) => !ALLOWED[emailType].includes(p))
        .map((p) => `${file}: {{${p}}} is not available in ${emailType} (variant ${variantKey})`),
    );

    expect(offenders).toEqual([]);
  });

  it("does not put the claim link in Email 1, which has no claim_url", () => {
    for (const { variantKey, placeholders } of seeded.filter((s) => s.emailType === "outreach_verify")) {
      expect(placeholders, `outreach_verify variant ${variantKey}`).not.toContain("claim_url");
    }
  });

  it("gives the new B variants an unsubscribe link", () => {
    // CAN-SPAM, and buildUnsubscribeHeaders sends the same URL in the
    // List-Unsubscribe header. The A bodies got theirs from a later UPDATE
    // migration (20260820230000) rather than at seed time, so this is asserted
    // where it is enforceable: the copy added with the variant itself.
    const bVariants = seeded.filter((s) => s.variantKey === "B");
    expect(bVariants).toHaveLength(2);

    for (const { emailType, placeholders } of bVariants) {
      expect(placeholders, `${emailType} variant B`).toContain("unsubscribe_url");
    }
  });
});
