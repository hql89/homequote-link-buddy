# Implementation Plan: Alarm on repeated unsubscribe token misses

## Objective

The public `unsubscribe` endpoint logs a `"No business for token"` failure when
someone presents a well-formed token that matches no business. Today that is
written to `job_run_logs` and nothing reads it: no alarm, no banner, no push.
A sustained run of these means real recipients are clicking a real unsubscribe
link and not getting unsubscribed — a CAN-SPAM / RFC 8058 compliance exposure
that would currently sit invisible in a log table until someone happened to
scroll the admin "Recent runs" panel.

This wires a **threshold-based** alarm (not per-failure) into that branch, so a
sustained failure rate surfaces on the existing `AlarmBanner` while ordinary
one-off noise stays quiet.

## Requirements captured

- **Outcome:** know within hours if the unsubscribe link is broken for real
  recipients; stay silent for isolated bad tokens.
- **Constraint:** the endpoint is public and unauthenticated
  (`verify_jwt = false`, [config.toml:50](supabase/config.toml:50)). Request
  rate is attacker-controlled, so the check must not become an amplification or
  log-flood vector.
- **Constraint:** must not bury other alarms. `admin_recent_alarms` returns
  `LIMIT 50` ([migration:46](supabase/migrations/20260820220000_admin_recent_alarms.sql:46)).
- **Success criteria:** see Acceptance Criteria below.

## Baseline (measured, not assumed)

Queried `job_run_logs` on 2026-08-20:

| Fact | Value |
|---|---|
| Lifetime `unsubscribe` rows | 11, all within a 2-minute window (01:35–01:37 UTC 2026-08-21) |
| — of those, `"No business for token"` | 7 |
| — of those, `"Invalid or missing token"` | 4 |
| Lifetime `unsubscribe` **successes** | **0** |
| `alarm` rows, last 7 days | 5 |
| `email-canary` rows, last 7 days | 147 (~21/day) |

So: no real recipient has ever successfully used this endpoint, and the only
traffic it has ever seen is one deploy-day smoke-test burst. Thresholds below
are set against that, and are explicitly marked for revisit once the drip sends
at volume.

## Key decisions

### 1. New `AlarmKind`, NOT `suppression_spike` — reusing it would be wrong

`suppression_spike` means *"unsubscribes are arriving far above the normal
rate"* — it fires when suppressions **succeed** too often
([alarm.ts:41-42](supabase/functions/_shared/alarm.ts:41),
[receive-inbound-email/index.ts:179-207](supabase/functions/receive-inbound-email/index.ts:179)).
This condition is the opposite: suppressions **failing**, zero of them applied.

Its banner title is a literal sentence rendered to the operator —
`"Unsubscribes are arriving far above the normal rate"`
([alarmDisplay.ts:39](src/lib/alarmDisplay.ts:39)). Firing it here would put a
false statement on screen and make the two conditions indistinguishable.

→ Add kind **`unsubscribe_token_misses`**.

### 2. Alarm on `"No business for token"` only — not `"Invalid or missing token"`

A malformed token ([index.ts:64](supabase/functions/unsubscribe/index.ts:64)) is
what a random scanner or a truncated link produces — high-noise, low-signal. A
*well-formed UUID that matches no business*
([index.ts:87](supabase/functions/unsubscribe/index.ts:87)) is specific: random
traffic does not produce valid UUIDs, so it means either the mailed links are
wrong or a business row was deleted out from under a live token.

### 3. Cooldown is mandatory, not a nicety

`checkSuppressionRate` can afford to run per-event because inbound-email rate is
bounded by the mail bridge. Here the caller sets the rate. Without a cooldown,
once over threshold **every subsequent bogus request inserts another alarm row**
— flooding `job_run_logs` and pushing every other alarm out of the 50-row
`admin_recent_alarms` window within seconds. That is precisely the invisibility
failure [alarm.ts:19-27](supabase/functions/_shared/alarm.ts:19) exists to
prevent.

→ Before raising, check for an existing `unsubscribe_token_misses` alarm inside
the cooldown window and skip if present. **Cooldown check runs first**, because
it short-circuits exactly when request volume is highest.

### 4. Proposed thresholds

| Knob | Value | Rationale |
|---|---|---|
| `WINDOW_HOURS` | 6 | Short enough to catch a bad send same-day |
| `THRESHOLD` | 10 misses in window | Above the 7-row deploy-test burst, so a repeat smoke test stays quiet. Against the drip's 50/day cap, 10 misses in 6h ≈ 20% of a day's links broken |
| `COOLDOWN_HOURS` | 6 | One alarm per window maximum |

Absolute, not relative — same reasoning as
[receive-inbound-email:172-177](supabase/functions/receive-inbound-email/index.ts:172):
there is no baseline yet to be relative to.

### 5. Helper goes in `_shared/`, so it is unit-testable

`checkSuppressionRate` lives inline in its `index.ts` and consequently has **no
unit test** — `index.ts` calls `Deno.serve` at module top level, so vitest
cannot import it. Putting this helper in `_shared/` follows the `raiseAlarm`
precedent ([alarm.test.ts](tests/unit/alarm.test.ts)) and keeps it testable.

## Acceptance Criteria

- [ ] A single `"No business for token"` failure raises **no** alarm.
- [ ] Crossing 10 misses within 6h raises exactly one `unsubscribe_token_misses` alarm.
- [ ] Further misses inside the cooldown window raise **no** additional alarm rows.
- [ ] `"Invalid or missing token"` failures never contribute to the count.
- [ ] A failure of the count query itself degrades quietly (logs, returns) and
      never breaks the unsubscribe response — matching
      [receive-inbound-email:190-196](supabase/functions/receive-inbound-email/index.ts:190).
- [ ] The endpoint's HTTP contract is unchanged: still 200 to one-click POST,
      still the same plain-text page to GET, in every branch.
- [ ] `AlarmBanner` renders a plain-language title for the new kind (no raw slug).
- [ ] `alarmDisplay.test.ts:31` (source-pinned kind coverage) passes.
- [ ] Full `npm run test` green, no regressions.

## Component Discovery

### Reused existing
- `raiseAlarm()` — [alarm.ts:56](supabase/functions/_shared/alarm.ts:56). Records to
  `job_run_logs`, never throws. No new alerting mechanism needed.
- `AlarmBanner` + `toDisplayAlarm()` — already surfaces any alarm kind on every
  admin page; unknown kinds already degrade gracefully
  ([alarmDisplay.ts:58-72](src/lib/alarmDisplay.ts:58)).
- `admin_recent_alarms` RPC — existing read path, no change.
- `job_run_logs_job_name_created_at_idx` — existing index covers both new queries.
- `checkSuppressionRate` — reused as the **pattern** (window + absolute
  threshold + non-fail-closed error handling), deliberately not extended,
  because its subject (successful suppressions) is a different table and a
  different meaning.

### New (justified)
- `checkTokenMissRate()` in `_shared/` — no existing helper counts recent
  `job_run_logs` rows or implements an alarm cooldown; nothing to extend.
- `AlarmKind: "unsubscribe_token_misses"` — see Decision 1.

## Files Changed

| File | Change | Reason |
|---|---|---|
| `supabase/functions/_shared/alarm.ts` | modify | Add `unsubscribe_token_misses` to `AlarmKind` + doc comment |
| `supabase/functions/_shared/alarmRate.ts` | **new** | `checkTokenMissRate()` — cooldown check, windowed count, raise |
| `supabase/functions/unsubscribe/index.ts` | modify | Call it in the `!business` branch ([:87-94](supabase/functions/unsubscribe/index.ts:87)), after `logRun`, before returning |
| `src/lib/alarmDisplay.ts` | modify | `TITLES` + `SEVERITY` entries for the new kind |
| `tests/unit/alarmRate.test.ts` | **new** | Threshold, cooldown, and error-degradation cases |

**Severity:** `warning`. It is a compliance-risk signal, not an outage —
`critical` is reserved for "sending was auto-disabled" and "an action silently
did not happen" ([alarmDisplay.ts:44-49](src/lib/alarmDisplay.ts:44)).

**Proposed title:** `"Unsubscribe links are failing to match a business"`

## Database Migrations

**None.** Uses the existing `job_run_logs` table, the existing
`job_run_logs_job_name_created_at_idx` index, and the existing
`admin_recent_alarms` RPC. No schema change, no column grant needed — the edge
function writes with the service role, as `raiseAlarm` already does.

## Test Strategy

**Unit** (`tests/unit/alarmRate.test.ts`, vitest + mocked supabase client,
mirroring [alarm.test.ts](tests/unit/alarm.test.ts)):
- below threshold → no alarm row written
- at/above threshold → exactly one alarm, correct `alarm_kind` and metadata
- above threshold **with** a recent alarm in cooldown → no second row
- count query returns an error → resolves, no throw, no alarm
- cooldown query is issued **before** the count query

**Regression:**
- `alarmDisplay.test.ts:31` already fails automatically if the new kind lacks a
  display entry — no new test needed, but it must be run and pass.

**Manual verification (staging/local, not production):**
- `curl` a well-formed but nonexistent UUID ≥10× → confirm exactly one `alarm`
  row appears and the banner renders the plain-language title.
- Confirm a real unsubscribe still succeeds end-to-end and writes `success`.
- Confirm GET still returns `text/plain` and POST still returns 200 in the miss
  branch.

## Rollback

Low-risk and fully additive — no schema change, no behavior change to the
existing response contract.

1. **Immediate:** revert the call site in
   `supabase/functions/unsubscribe/index.ts` and redeploy
   (`supabase functions deploy unsubscribe`). The alarm stops; nothing else in
   the endpoint depends on it.
2. **Full:** `git revert` the commit and redeploy. The new `AlarmKind` string is
   additive; any already-written alarm rows keep rendering via the
   unknown-kind fallback in `toDisplayAlarm`, so reverting the frontend cannot
   make a recorded alarm disappear.
3. **Data:** no cleanup required. Alarm rows are ordinary `job_run_logs` rows;
   delete with
   `DELETE FROM job_run_logs WHERE metadata->>'alarm_kind' = 'unsubscribe_token_misses';`
   only if desired.

## Open questions for approval

1. **Thresholds** — 10 misses / 6h window / 6h cooldown. Tighter (5/1h) catches
   a broken send faster but is likelier to fire on a scanner that happens to
   send valid-shaped UUIDs. Comfortable with 10/6h?
2. **Should `"Invalid or missing token"` also be counted**, in a separate
   lower-priority alarm? Recommendation: no, not yet — it is scanner noise
   until there is evidence otherwise.
