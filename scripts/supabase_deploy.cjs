#!/usr/bin/env node
/**
 * Deploys Supabase edge functions to THIS project, always.
 *
 * Why this exists: `supabase functions deploy` falls back to an interactive
 * "Select a project" prompt whenever the working directory isn't linked. With
 * several Supabase projects on one machine that is one arrow-key away from
 * deploying this repo's functions into a different project. This script reads
 * the ref from supabase/config.toml and passes --project-ref explicitly, so the
 * target is pinned by the repo rather than by CLI state or whatever directory
 * you happen to be standing in.
 *
 * Usage:
 *   node scripts/supabase_deploy.cjs                  # directory-engine functions
 *   node scripts/supabase_deploy.cjs fn-a fn-b        # specific functions
 *   node scripts/supabase_deploy.cjs --all            # every function in the repo
 *   node scripts/supabase_deploy.cjs --dry-run        # print the plan only
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const CONFIG = path.join(REPO_ROOT, "supabase", "config.toml");
const FUNCTIONS_DIR = path.join(REPO_ROOT, "supabase", "functions");

/** Functions belonging to the directory engine. */
const DIRECTORY_ENGINE = [
  "ingest-business",
  "send-outreach-drip",
  "claim-listing",
  "submit-directory-lead",
];

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

if (!fs.existsSync(CONFIG)) {
  fail(`supabase/config.toml not found at ${CONFIG}. Run this from the repo.`);
}

const projectRef = (fs.readFileSync(CONFIG, "utf8").match(/^project_id\s*=\s*"([^"]+)"/m) || [])[1];
if (!projectRef) fail("Could not read project_id from supabase/config.toml.");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const all = args.includes("--all");
const named = args.filter((a) => !a.startsWith("--"));

let targets;
if (named.length) {
  targets = named;
} else if (all) {
  targets = fs
    .readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name);
} else {
  targets = DIRECTORY_ENGINE;
}

// Fail before deploying anything rather than half-way through a batch.
const missing = targets.filter((t) => !fs.existsSync(path.join(FUNCTIONS_DIR, t, "index.ts")));
if (missing.length) fail(`No index.ts for: ${missing.join(", ")}`);

console.log(`\nProject : ${projectRef}`);
console.log(`Deploying ${targets.length} function(s):`);
targets.forEach((t) => console.log(`  • ${t}`));

if (dryRun) {
  console.log("\n(dry run — nothing deployed)\n");
  process.exit(0);
}

const failures = [];
for (const fn of targets) {
  process.stdout.write(`\n→ ${fn} … `);
  try {
    execFileSync("supabase", ["functions", "deploy", fn, "--project-ref", projectRef], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log("deployed");
  } catch (err) {
    const out = `${err.stdout || ""}${err.stderr || ""}`.trim();
    console.log("FAILED");
    failures.push({ fn, out: out.slice(-400) });
  }
}

if (failures.length) {
  console.error(`\n✖ ${failures.length} of ${targets.length} failed:\n`);
  failures.forEach(({ fn, out }) => console.error(`--- ${fn} ---\n${out}\n`));
  process.exit(1);
}

console.log(`\n✔ All ${targets.length} function(s) deployed to ${projectRef}\n`);
