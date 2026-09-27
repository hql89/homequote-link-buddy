import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Three places have to agree on the set of inbound classifications:
 *
 *   1. the `inbound_emails_classification_check` CHECK constraint,
 *   2. the `InboundClassification` union in integrations/supabase/directory.ts,
 *   3. the `CLASSIFICATION_LABEL` map in /admin/replies.
 *
 * Nothing enforced that. The union is used as a `Record` key, so a value the
 * database allows but the union omits renders an EMPTY badge rather than
 * failing to compile — which is exactly what the one production `bounce` row
 * was doing before someone noticed by eye.
 *
 * Parsed from source, like alarmDisplay.test.ts does with AlarmKind, so
 * widening the constraint without updating the frontend fails here instead of
 * silently in production.
 */

const MIGRATIONS = join(__dirname, "../../supabase/migrations");

/** Values in the most recent migration that (re)defines the CHECK. */
function constraintValues(): string[] {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

  for (const file of [...files].reverse()) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const idx = sql.lastIndexOf("inbound_emails_classification_check");
    if (idx === -1) continue;

    // The ADD CONSTRAINT, not an earlier DROP ... IF EXISTS of the same name.
    const check = sql.slice(idx).match(/check\s*\(([\s\S]*?)\)\s*;/i);
    if (!check) continue;

    const values = [...check[1].matchAll(/'([a-z_]+)'\s*::\s*text/gi)].map((m) => m[1]);
    if (values.length > 0) return values;
  }
  throw new Error("No migration defines inbound_emails_classification_check");
}

function unionMembers(): string[] {
  const src = readFileSync(join(__dirname, "../../src/integrations/supabase/directory.ts"), "utf8");
  const start = src.indexOf("export type InboundClassification");
  const block = src.slice(start, src.indexOf(";", start));
  return [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

function labelKeys(): string[] {
  const src = readFileSync(join(__dirname, "../../src/pages/admin/Replies.tsx"), "utf8");
  const start = src.indexOf("const CLASSIFICATION_LABEL");
  const block = src.slice(start, src.indexOf("};", start));
  return [...block.matchAll(/^\s*([a-z_]+)\s*:/gm)].map((m) => m[1]);
}

describe("inbound classification stays in step across all three definitions", () => {
  const fromDb = constraintValues();

  it("finds the constraint at all", () => {
    // Guards the parser: a rename that breaks these regexes must fail loudly,
    // not pass vacuously.
    expect(fromDb.length).toBeGreaterThan(5);
    expect(fromDb).toContain("unsubscribe");
  });

  it("the TypeScript union covers exactly what the database allows", () => {
    expect([...unionMembers()].sort()).toEqual([...fromDb].sort());
  });

  it("every allowed value has a label in /admin/replies", () => {
    const labels = labelKeys();
    const missing = fromDb.filter((v) => !labels.includes(v));
    expect(missing, "classifications the Replies badge would render empty").toEqual([]);
  });
});
