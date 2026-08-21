# Deployment Report

**Version:** commits `b51938d`, `14f2907` on `main`
**Date:** 2026-08-20 (applied 2026-08-21 00:35–01:40 UTC)
**Environment:** Production (Supabase project `lrqdbpphallqehpdqalr`, homequotelink.com)

## Changes Deployed

Outreach emails had no compliant, working opt-out — code comments claimed the copy "literally instructs reply STOP" while it only ever said "reply YES." This deploy closes that gap:

- **Email copy** (`outreach_template_variants`, variant A, both stages): added an explicit "Reply STOP, or unsubscribe here: {{unsubscribe_url}}" line.
- **New public edge function `unsubscribe`**: authorized by the existing `claim_token` (no new secret). Handles a human clicking the link (GET) and RFC 8058 one-click unsubscribe from mail providers (POST). Writes `businesses.outreach_suppressed_at`, the same column `send-outreach-drip` already filters sends on.
- **`List-Unsubscribe` / `List-Unsubscribe-Post` headers** added to every outreach send (`mailer.ts`, both SMTP and Resend paths), so Gmail/Yahoo/Outlook show their own native "Unsubscribe" button.
- **Mid-deploy fix**: the first version of `unsubscribe` rendered an HTML confirmation page. Smoke testing caught that Supabase Edge Functions silently rewrite `GET` responses to `text/plain` regardless of the function's own `Content-Type` ("HTML content is not supported" — confirmed against Supabase's own docs and by contrast with `claim-listing`'s untouched `application/json`). Fixed to author the confirmation as plain text on purpose before this went live.

## Verification

- **Tests:** 152/152 relevant unit tests pass (5 files: directoryHelpers, emailSafety, inboundClassifier, outreachReadiness, outreachVariants), including 6 new tests added for this change. Full suite: 522/523 passing — the 1 failure (`ProviderDashboardInfinite.test.tsx`, `ResizeObserver is not defined`) is confirmed pre-existing on a clean `main` checkout, unrelated to this change.
- **Build:** `npm run build` succeeds.
- **Type check:** `npx tsc --noEmit` — zero errors. `deno check` on all 4 touched/new edge function files — zero errors.
- **Lint:** zero errors.
- **npm audit:** 25 pre-existing high/critical findings, all in dev-tooling packages (rollup, vitest, postcss, etc.), none introduced by this change. Known debt — see [React Router audit debt](homequote-react-router-audit-debt.md) memory; not addressed here.
- **Migration applied:** `supabase db push` applied `20260820230000_outreach_unsubscribe_compliance.sql`. Confirmed via direct query that both live template rows (`outreach_verify` A, `outreach_preview` A) now contain the opt-out line and `{{unsubscribe_url}}`. Confirmed via `list_migrations` that the version is recorded in migration history.
- **Functions deployed:** `unsubscribe` (new, v1) and `send-outreach-drip` (v16 → v17, to pick up the new imports). Confirmed live via `list_edge_functions`, `verify_jwt: false` as intended.
- **Smoke test (production, no real business data touched):**
  - Malformed token (GET) → 200, `text/plain`, "This unsubscribe link is invalid or has expired."
  - Well-formed but nonexistent token (GET) → same, correctly not found.
  - Well-formed but nonexistent token (POST/one-click) → 200, empty body, as RFC 8058 expects.
  - Not independently tested: the "real business found → suppression written" branch, to avoid inserting synthetic rows into the live `businesses` table (unknown trigger/side-effect risk). That code path is a single `.update().eq().is()` call, same shape already exercised elsewhere in this codebase (`send-outreach-drip`'s own stamp writes). Flagging as the one unverified branch rather than asserting it's fine.
- **Security advisors:** checked post-deploy — all findings pre-existing (SECURITY DEFINER views/functions, auth password protection), none reference the new function, the migration, or `outreach_suppressed_at`.

## Rollback Procedure

1. **Function:** `supabase functions delete unsubscribe` removes the new endpoint. Existing `List-Unsubscribe` headers in already-sent mail would then point at a dead link (harmless — mail clients treat a failed one-click as a no-op) until `send-outreach-drip` is redeployed from the pre-fix commit.
2. **`send-outreach-drip`:** redeploy from commit `2cf6772` (last commit before this change) to drop the `List-Unsubscribe` headers and `unsubscribe_url` var.
3. **Template copy:** revert by re-running the original `INSERT` bodies from `20260814130000_outreach_variants_and_daily_cap.sql` against `outreach_template_variants` (documented in the rollback comment inside `20260820230000_outreach_unsubscribe_compliance.sql`). Not a schema change — no `DROP` needed, since no new columns or tables were added; `businesses.outreach_suppressed_at` already existed before this change.
4. **Git:** `git revert 14f2907 b51938d` on `main`.

No database schema changed (no new tables/columns) — only two `outreach_template_variants` rows were updated, and one new edge function was added. This makes rollback low-risk: reverting is copy/function changes only, nothing structural.
