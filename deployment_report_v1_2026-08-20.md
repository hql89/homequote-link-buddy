# Deployment Report

**Version:** unsubscribe edge function, v3 (Supabase function version, per `get_edge_function`)
**Date:** 2026-08-20 (deployed 2026-08-21 02:05 UTC)
**Environment:** Production — Supabase project `lrqdbpphallqehpdqalr`

## Changes Deployed

- New `checkTokenMissRate()` helper ([supabase/functions/_shared/alarmRate.ts](supabase/functions/_shared/alarmRate.ts)): counts `"No business for token"` unsubscribe failures in a rolling 6h window and raises one `unsubscribe_token_misses` alarm at 10, then stays quiet for a 6h cooldown regardless of further misses.
- Wired into [supabase/functions/unsubscribe/index.ts](supabase/functions/unsubscribe/index.ts)'s `!business` branch only — malformed/missing tokens are untouched, per explicit decision to skip that alarm for now.
- New `AlarmKind: "unsubscribe_token_misses"` added to [supabase/functions/_shared/alarm.ts](supabase/functions/_shared/alarm.ts) and given a plain-language banner title in [src/lib/alarmDisplay.ts](src/lib/alarmDisplay.ts): *"Unsubscribe links are failing to match a business"*, severity `warning`.
- No database migration. No change to the endpoint's HTTP contract (still 200 to POST, still the same plain-text page to GET, in every branch).

## Verification

- **Tests:** ✓ 537/537 passing (`npm run test`), including 7 new tests in `tests/unit/alarmRate.test.ts` covering threshold, cooldown, cooldown-runs-before-count ordering, and both query-failure degradation paths. The pre-existing source-pinned `alarmDisplay.test.ts` kind-coverage test also passes.
- **Typecheck:** ✓ `tsc --noEmit` clean.
- **Lint:** ✓ `eslint .` clean.
- **Build:** ✓ `vite build` succeeds.
- **npm audit:** 25 pre-existing vulnerabilities (postcss, rollup, vitest, ws, yaml) — confirmed unrelated to this change (`package.json`/`package-lock.json` untouched) and confined to dev/build tooling, not the Deno edge-function runtime this deploy shipped. Not remediated here; flagging as known debt rather than blocking, consistent with this project's accepted react-router audit debt.
- **Deploy:** ✓ `supabase functions deploy unsubscribe` — succeeded, uploaded `index.ts` + all 5 shared modules including the new `alarmRate.ts`.
- **Post-deploy fetch:** ✓ pulled the live deployed source via `get_edge_function` — byte-for-byte matches what was tested locally (confirms no stale bundle / partial upload).
- **Smoke test:** ✓ live `GET` with a well-formed but nonexistent token → `200`, `text/plain`, `"This unsubscribe link is invalid or has expired."` (unchanged from pre-deploy behavior). Confirmed in `job_run_logs`: both smoke-test hits logged correctly as `"No business for token"` failures, and — since 2 misses is well under the 10-miss threshold — no alarm fired, confirming the new check runs without breaking the request or false-triggering.

## Rollback Procedure

1. **Fast path:** `git revert` the commit touching `supabase/functions/unsubscribe/index.ts` and `supabase/functions/_shared/alarmRate.ts`, then `supabase functions deploy unsubscribe`. The alarm check is fully additive — nothing else in the endpoint depends on it, so this alone restores prior behavior with zero data cleanup required.
2. **Frontend-only rollback** (if only the banner display is a problem): revert `src/lib/alarmDisplay.ts` and `supabase/functions/_shared/alarm.ts`. Any already-recorded `unsubscribe_token_misses` alarm rows will still render via the existing unknown-kind fallback in `toDisplayAlarm`, so this can't lose data either way.
3. **Optional cleanup:** no cleanup is required, but if desired:
   `DELETE FROM job_run_logs WHERE metadata->>'alarm_kind' = 'unsubscribe_token_misses';`
