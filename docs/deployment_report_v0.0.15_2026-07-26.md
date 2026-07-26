# Deployment Report — notify-admin-email Fix

**Version:** 0.0.15
**Date:** 2026-07-26
**Environment:** Production ✅
**Supabase project:** `lrqdbpphallqehpdqalr`

## Changes Deployed

### Bug fix: `notify-admin-email` edge function deployed
- **Symptom**: "Test failed: Failed to send a request to the Edge Function" in Admin → Settings → Send Test Email.
- **Root cause**: `notify-admin-email` existed in source control but had never been deployed to production. The function was missing from the Supabase project entirely.
- **Fix**: Deployed `notify-admin-email` via `supabase functions deploy notify-admin-email --no-verify-jwt`.
- **Result**: The endpoint is now reachable. Test emails will proceed to the SMTP send step; any remaining failure will surface a specific SMTP error (credentials, port, timeout) instead of the generic "Failed to send a request" message.

### Source control: `twilio-missed-call` added
- This function was already deployed (version 2) but had never been committed to the repo. Added to bring source control in sync with production.

## Gate result: 5 of 5 pass

| Check | Result |
|---|---|
| Tests | ✅ **78 passed** (10 files) |
| Build | ✅ succeeds |
| Lint | ✅ 0 errors |
| Type check | ✅ 0 errors |
| npm audit | ⚠️ 24 vulnerabilities (pre-existing, not regressions) |

### Audit triage
Same as v0.0.14 — `react-router` XSS in v6 line requires v6→v7 migration (tracked separately). Everything else is build/dev tooling. No regressions introduced.

## Verification

**Pre-deploy** — 78 tests, 0 lint, 0 type errors, build clean.

**Post-deploy**:
- `notify-admin-email` confirmed present in `supabase functions list` output after deploy.
- `smtp_config` row confirmed present in `admin_settings` — function will find SMTP config on first call.
- Test email flow: Admin → Settings → Send Test Email should now reach the edge function. If SMTP credentials are not yet configured, the error returned will be SMTP-specific (e.g., "SMTP connection timed out") rather than the generic edge function unreachable error.

## No Rollback Required

`notify-admin-email` was a missing deployment, not a code change. Rollback = redeploy previous version or toggle off in Supabase dashboard. No database changes. No frontend changes.

## Open Items (carried forward from v0.0.14)

- **SMTP configuration**: SMTP host/port/credentials must be entered in Admin → Settings for test emails to actually deliver. The function is deployed; the config is the remaining step.
- **Directory is empty (0 businesses)** — gates outreach; need real CSLB import
- **Phase 2 email enrichment** blocked on Perplexity key provisioning
- **pg_cron not installed** — worker runs via "Run now" button only
- `ingest-business` broken auth and `ai-company-lookup` fabricates facts — separate tasks
