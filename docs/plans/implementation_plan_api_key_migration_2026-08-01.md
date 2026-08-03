# Implementation Plan — Migrate to Supabase Publishable/Secret API Keys

**Status:** Draft — awaiting approval
**Date:** 2026-08-01
**Project ref:** `lrqdbpphallqehpdqalr`

---

## Objective

Move every consumer off the legacy `anon` / `service_role` keys and onto Supabase's
new `sb_publishable_…` / `sb_secret_…` keys, then disable the legacy pair.

Two independent reasons, and the second is the decisive one:

1. **Security.** `migrate-helper` (deleted 2026-08-01, `2bc0c66`) would have returned
   `SUPABASE_DB_URL` and `SUPABASE_SERVICE_ROLE_KEY` to anyone with a hardcoded access
   key. Follow-up review (`docs/bugs.md`, `b750d2e`) established the repo is private and
   two independent signals say the function was never deployed — real exposure **low,
   not zero**. The recommended remedy was rotating the service-role key.

2. **That rotation is impossible.** Supabase has removed the ability to rotate legacy
   `anon`/`service_role` keys and is retiring them entirely by end of 2026. Migration is
   therefore the *only* way to invalidate the possibly-exposed key — and is mandatory
   regardless. This is a question of *when*, not *whether*.

Doing it also buys a capability the old system lacked: the new secret keys **can** be
rotated individually and immediately, so a future incident is a five-minute fix.

---

## Acceptance Criteria

- [ ] No file in `supabase/functions/` reads `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_ANON_KEY`.
- [ ] All 21 deployed functions verified working against the live project after cutover.
- [ ] The public site loads, a listing page renders, and the quote form still submits.
- [ ] Admin login works and an admin-only read (e.g. Background Jobs) returns data.
- [ ] Supabase API logs show **zero** legacy-key requests over a full 24h window before
      legacy keys are disabled.
- [ ] Legacy keys disabled in the dashboard, with the site still fully working afterwards.
- [ ] `npx vitest run` green throughout (currently 311).

**Explicitly NOT in scope:** revoking the legacy JWT secret (see §7 — one-way door,
separate decision after this has been stable for a while).

---

## Current State (verified 2026-08-01, not assumed)

| Fact | Value |
|---|---|
| Functions reading `SUPABASE_SERVICE_ROLE_KEY` | **28** |
| Functions also reading `SUPABASE_ANON_KEY` | **6** (`_shared/directory.ts`, `purge-analytics`, `purge-archived`, `send-buyer-notification`, `send-lead-confirmation`, `system-status`) |
| Functions deployed | **21** — 7 in repo are undeployed (`ai-image`, `ai-writer`, `analyze-lead`, `publish-scheduled`, `receive-article`, `rss-feed`, `send-nurture-emails`) |
| New keys already created | Yes — `sb_publishable_Vno3bg7…`, `sb_secret_DPacf…`, both named `default` |
| New env vars already present | Yes — `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS` |
| Frontend consumers of the key | **1** — `src/integrations/supabase/client.ts` |
| n8n workflow | Authenticates with `x-webhook-token`, contains **zero** JWTs — **unaffected** |
| Migrations embedding the legacy anon JWT | 5 (see §4) |

**The single most useful finding:** the frontend variable is *already named*
`VITE_SUPABASE_PUBLISHABLE_KEY` — it just currently holds the legacy anon JWT. So the
frontend needs **no code change at all**, only a value swap. `client.ts` is also marked
"automatically generated, do not edit", which we now don't need to.

---

## Design Decisions

### 1. One shared helper, not 28 hand-rolled parses

New `supabase/functions/_shared/supabaseKeys.ts`:

```
serviceRoleKey(): string     // from SUPABASE_SECRET_KEYS["default"]
publishableKey(): string     // from SUPABASE_PUBLISHABLE_KEYS["default"]
```

Justified as new: nothing equivalent exists, and the alternative is `JSON.parse` repeated
28 times with 28 different failure modes. One helper means one place to fix if the key
name ever changes from `default`, and one error message when it goes wrong.

### 2. No silent fallback to the legacy key — argued both ways

**For a fallback** (`?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`): a function deployed
somewhere without the new var keeps working. Safer-feeling rollout.

**Against, and decisive:** a silent fallback masks *exactly* the condition this migration
exists to detect. If half the functions quietly fall back, everything looks healthy right
up until legacy keys are disabled — at which point they all fail simultaneously, in
production, with no signal about which ones. The fallback converts a loud, cheap,
pre-cutover failure into a silent, expensive, post-cutover one.

It is also unnecessary: both new vars are **already confirmed present** in the deployed
environment, so the fallback would be dead code whose only function is to hide failure.

**Decision: fail loudly.** The helper throws a named error if the var is missing or
malformed. Rollback is a revert-and-redeploy (§7), not a runtime fallback.

### 3. Frontend: value swap only

Change the *value* of `VITE_SUPABASE_PUBLISHABLE_KEY` in two places:
- `.env` (local dev)
- **Vercel's environment variables** — a separate copy this repo cannot see or change

The Vercel one is the actual production site. Changing `.env` alone changes nothing for
visitors. Vercel also requires a **redeploy** for a changed env var to take effect.

### 4. The 5 migrations with hardcoded anon JWTs

`20260421141700`, `20260429151254`, `20260429151343`, `20260725150000`, `20260801160000`
embed the legacy anon JWT inside pg_cron `net.http_post` commands.

**Rewriting those files: rejected.** They are already applied; editing applied migrations
breaks checksum expectations and destroys the historical record of what was actually run.

**Forward migration instead**, which redefines `admin_toggle_cron_job` with the new
publishable key.

**Urgency: low, and this is worth stating precisely.** Only `prune-internal-job-logs-daily`
is currently scheduled, and it calls a SQL function directly with no key. The one job that
*would* use the key — `send-outreach-drip-daily` — is currently unscheduled pending the
Byethost suspension. So nothing live depends on those hardcoded keys today. This must land
**before outreach is re-enabled**, not before cutover.

**Worth considering while we are in there:** check whether those functions need a key at
all (`verify_jwt` may be false for them), in which case the cleanest fix is to stop
embedding a key rather than embed a newer one.

### 5. Finding external consumers before we break them

The genuine unknown is anything outside this repo still using a legacy key. n8n is now
ruled out. Others might exist (scripts, Zapier, the Lovable platform itself, an old
Postman collection).

**Do not guess — measure.** Supabase's API logs record which key each request used. Before
disabling legacy keys, watch for a **full 24 hours** with zero legacy-key requests. That
converts an unknowable list into an observable signal, and 24h covers anything on a daily
schedule.

---

## Files Changed

| File | Change | Reason |
|---|---|---|
| `supabase/functions/_shared/supabaseKeys.ts` | **new** | Single parse point for both new key vars |
| `supabase/functions/_shared/directory.ts` | modify | Reads both legacy keys (`isPrivilegedCaller`) |
| 27 × `supabase/functions/*/index.ts` | modify | Swap `Deno.env.get(...)` for the helper |
| `.env` | modify | Value swap (local dev only) |
| **Vercel env var** | modify | *Outside the repo — the user's step* |
| `supabase/migrations/2026080…_cron_publishable_key.sql` | **new** | Forward fix for §4 |
| `tests/unit/supabaseKeys.test.ts` | **new** | Helper parsing + failure modes |

`src/integrations/supabase/client.ts` — **unchanged.** See §3.

---

## Phases

Each phase is independently revertible and must be proven before the next starts.

**Phase 1 — Helper + tests.** No behaviour change; nothing calls it yet.
*Proof:* unit tests for valid JSON, missing var, malformed JSON, missing `default` key.

**Phase 2 — Cut over all 28 functions, deploy the 21 that are deployed.**
*Proof:* `supabase functions list` shows fresh timestamps; then exercise the live endpoints
that can be safely triggered — `sitemap` (public GET, expect XML), `system-status`
(admin-gated, expect 401 unauthenticated rather than a 500), `send-outreach-drip` (expect
the existing `halted: delivery_unverified` response, which proves it reached its own logic
with a working key). The 7 undeployed functions get the code change but cannot be verified
live; that is stated, not hidden.

**Phase 3 — Frontend value swap** (`.env`, then Vercel, then redeploy).
*Proof:* load the live site, open a listing page, confirm listings render (they come from
the database via the publishable key), submit the quote form, and log into `/admin`.

**Phase 4 — Watch the logs for 24h.**
*Proof:* zero legacy-key requests in Supabase's API logs.

**Phase 5 — Disable legacy keys** *(user's dashboard step)*.
*Proof:* repeat the Phase 2 and 3 checks immediately afterwards.

**Phase 6 — Forward migration for the cron key** — before outreach is re-enabled, not before cutover.

---

## Test Strategy

- **Unit (vitest):** the helper — valid parse, missing env var, malformed JSON, absent
  `default` key. Each must fail with a message naming the variable.
- **jsdom over a mocked client:** unchanged; admin routes are auth-gated and this is the
  project convention. No admin test should need modifying — the key is infrastructure, not
  application logic. *If one does break, that is a signal worth investigating, not patching.*
- **Live verification:** per phase above. `supabase functions list` plus targeted `curl`
  has been the reliable way to confirm deployed behaviour in this project; the CLI's own
  success output has already proven untrustworthy once today (`storage rm`), so verify
  against observable results, not reported ones.
- **Regression:** full `npx vitest run` (311 baseline) after every phase.

---

## Rollback — and which doors only open one way

| Phase | Reversible? | How |
|---|---|---|
| 1 Helper | Yes | Revert commit; nothing depended on it |
| 2 Functions | Yes | `git revert` + redeploy; legacy env vars still exist until Phase 5 |
| 3 Frontend | Yes | Restore the old value in Vercel, redeploy |
| 4 Log watch | N/A | Observation only |
| 5 Disable legacy keys | **Believed yes** — the dashboard presents this as a toggle. **Verify before relying on it.** | Re-enable in dashboard |
| Revoke legacy JWT secret | **NO — one-way** | Not in scope. Do not do this. |

**The one-way door, stated plainly:** revoking the legacy JWT secret on the JWT Keys page
cannot be undone. Every token signed by it dies instantly. It is *not* part of this plan
and should not be touched until this migration has been stable for a good while — and even
then, as its own separate, deliberate decision.

Phases 1–3 are all revertible **because the legacy keys keep working until Phase 5**. That
is the property that makes this safe, and it is why Phase 5 comes only after a full day of
evidence.

---

## Sequencing vs. the Byethost email suspension

**Recommendation: do this now, and the reason is the suspension, not despite it.**

Outreach is unscheduled, no email is sending, and the site is quiet. That is the ideal
window for infrastructure work: if something breaks, it is the only variable in play.
Doing it later — while outreach is live and emailing real contractors — means debugging
two systems at once.

The one genuine interaction is §4: the forward migration for the cron key must land before
outreach is re-enabled. That is sequencing, not conflict.

---

## Open Questions

1. **Anything outside this repo using these keys?** n8n is ruled out. Phase 4's log watch
   is designed to answer this empirically rather than by recall — but if you already know
   of a script, integration, or saved API call, say so now and save a day.
2. **Is disabling legacy keys genuinely reversible?** Worth confirming in the dashboard
   copy before Phase 5, rather than assuming.
3. **Do the cron-invoked functions need a key at all?** If `verify_jwt` is false for them,
   §4 can remove the embedded key rather than update it.

---

## Plain-language summary

Your website and its 28 background programs all use one master password to talk to your
database. That password is the one that *might* have been exposed by the tool we deleted
this morning — and Supabase no longer lets anyone change it. They're retiring that whole
password system by the end of next year.

So the fix isn't changing the password. It's moving everything onto Supabase's newer
system, which was already set up for you but isn't being used yet. Once everything's moved,
you switch the old password off and it stops mattering whether it ever leaked.

**How it goes:**

1. Write one small piece of shared code that fetches the new password *(nothing changes yet)*
2. Point all 28 background programs at it, and check the live ones still work
3. Point the website at the new password — one setting on your `.env`, one on Vercel
4. Watch for a full day to catch anything still quietly using the old password
5. **You** switch the old password off in the dashboard — I can't and shouldn't do that
6. Later, before restarting outreach emails, one small database fix

**Good news:** your website itself needs no code changes — the setting is already named
correctly, it just holds the old value. And your email-reading connection (n8n) uses a
different kind of password entirely, so it won't be affected. I checked both.

**The one thing to never touch:** on that JWT Keys page you were looking at, there's an
option to revoke the old key. That one **cannot be undone** and would instantly break
everything. It's not part of this plan. Leave it alone.

**When:** now is actually the best time — your outreach is switched off and the site is
quiet, so if anything breaks it's the only thing changing. Doing this later, while emails
are going out, means untangling two problems at once.
