# Implementation Plan: Make the bounce shut-off actually protective, and check domains before first contact

## Correction to what was proposed

I proposed building a bounce circuit breaker. **It already exists** — Gate 2 in
`send-outreach-drip/index.ts`, added in `fc21bbb`, and confirmed present in the deployed
function (deploy state is not in git, so this was checked against the live source, not
assumed).

So this is not a build. It is a tuning-and-surfacing job, which is a different and smaller
piece of work. The honest summary of the gap:

| | Today | Problem |
| --- | --- | --- |
| Threshold | `0.5` — halts at a **50%** bounce rate | Mailbox providers penalise sustained bounce rates above roughly 2–5%. A breaker that waits for half of all mail to fail fires long after the reputation damage is done. |
| Min sample | 10 | With a 5/day cap, 1 bounce in 10 is 10% — so a tighter threshold at this sample size would halt the campaign over a single stale address. Sample and threshold have to move together. |
| Window | 7 days | Reasonable. Unchanged. |
| Visibility | `job_run_logs` row with `status: 'partial'` | Nothing raises an alarm, so `AlarmBanner` (which reads `job_name = 'alarm'`) stays silent. A halted campaign looks identical to a quiet one. |
| Tunability | Three hardcoded constants | Changing the threshold needs a code change and a redeploy, unlike `daily_limit` and `bcc_email`, which are already config. |

One further thing found while reading: the comment on `checkVolumeCircuitBreaker` in
`_shared/emailSafety.ts` says the bounce breaker is untrustworthy because the inbound email
bridge "has never delivered a single message (`select count(*) from inbound_emails` = 0 as of
2026-08)". That is now out of date — `inbound_emails` holds 19 rows, and a real bounce on
2026-08-23 was correctly classified and flipped `email_send_log.status` to `bounced`. The
bounce breaker is now genuinely fed. The comment should say so.

---

## Phase A — Tighten and surface the existing bounce breaker

### Numbers, and the reasoning for them

Current real data: 31 outreach emails sent, 1 bounced — **3.2%**.

- **Threshold 0.5 → 0.15.** Halts at a 15% bounce rate. Comfortably above the 3.2% the
  campaign actually runs at, so normal address staleness never trips it; far below the point
  where a provider would act.
- **Min sample 10 → 20.** At 15%, a sample of 20 means 3 bounces to halt. A sample of 10 would
  mean 2, which is close enough to ordinary noise to stop the campaign for no reason. At
  5/day, 20 sends accumulates in four days, well inside the 7-day window.

Both become overridable from `outreach_config`, matching `daily_limit`. The constants stay as
the defaults, so behaviour is unchanged if the config keys are absent.

### Files changed
| File | Change |
| --- | --- |
| `supabase/functions/_shared/emailSafety.ts` | New pure `evaluateBounceCircuit()` holding the decision; correct the stale `inbound_emails` comment |
| `supabase/functions/send-outreach-drip/index.ts` | Read thresholds from config, call the shared function, raise an alarm when it trips |
| `supabase/functions/_shared/alarm.ts` | New `AlarmKind`: `outreach_bounce_rate` |
| `tests/unit/emailSafety.test.ts` | Extend with the new cases |

### Test strategy
The decision moves into a pure function precisely so it can be tested without a database, the
same reason `pickVariant` and `remainingDailyBudget` were split out of this function before.
Cases: below sample floor never trips regardless of rate; at/over threshold with enough sample
trips; under threshold does not; zero sends does not divide by zero; config overrides apply;
malformed config falls back to defaults rather than to `NaN` comparisons (which are always
false and would silently disable the breaker).

### Rollback
Revert the source files. No schema change. Config keys, if written, are ignored by the old code.

### Acceptance criteria
- [ ] Breaker halts at 15% over a 20-send sample, by default
- [ ] Thresholds overridable from `outreach_config`; absent/garbage config uses defaults
- [ ] Tripping raises an alarm visible to `AlarmBanner`, in addition to the existing log row
- [ ] A bad config value can never silently disable the breaker
- [ ] Full suite passes

---

## Phase B — Check the domain accepts mail before first contact

### What this does and does not catch

Honest scope, since this was oversold when proposed. It catches an address whose **domain**
cannot receive mail at all — dead domain, expired registration, a site with no mail
exchanger. It does **not** catch a valid domain with a non-existent mailbox, which is exactly
what the one real bounce was (`contact@thynkremodeling.com`, `recipient_invalid`). Catching
that would need an SMTP probe against the recipient's server, which is itself a
reputation-damaging thing to do and is not proposed.

So: a cheap filter on a real class of bad address, not a bounce cure. Phase A is the actual
protection.

### Why DNS-over-HTTPS rather than a DNS lookup

`Deno.resolveDns` is not dependable on Supabase's edge runtime, and a safety check that throws
on an unsupported API is worse than no check. A DoH query is an ordinary `fetch`, which this
function already does, so it works wherever the function runs and is trivially mockable in
tests.

### Decision table

Marking a business undeliverable is consequential: `email_undeliverable_at` gates the drip
*and*, since `2807d3b`, quote-request notifications. A false positive silences a real
business's leads. So a mark is only ever written on an authoritative DNS answer.

| DNS result | Verdict | Action |
| --- | --- | --- |
| `NXDOMAIN` | Conclusively no mail | Mark undeliverable, skip |
| MX records present | Deliverable | Send |
| Null MX (`.`, RFC 7505) | Conclusively no mail | Mark undeliverable, skip |
| No MX, but A/AAAA present | Deliverable via implicit MX (RFC 5321) | Send |
| No MX and no A/AAAA | Conclusively no mail | Mark undeliverable, skip |
| Timeout, network error, non-JSON, any other status | **Inconclusive** | Skip this run only. No mark. Retried next run. |

Checked only before Email 1. Email 2 goes to an address that already accepted Email 1, so
re-checking spends a lookup to learn nothing.

### Files changed
| File | Change |
| --- | --- |
| `supabase/functions/_shared/mailDomain.ts` | New. `domainOf()`, `checkMailDomain()`, injectable fetch |
| `supabase/migrations/<ts>_email_undeliverable_reason.sql` | New `businesses.email_undeliverable_reason` column |
| `supabase/functions/send-outreach-drip/index.ts` | Gate Email 1 on the check |
| `tests/unit/mailDomain.test.ts` | New |

### Why a new column
`email_undeliverable_at` alone cannot distinguish "the recipient's server rejected this
mailbox" from "this domain has no mail server", and those have different fixes. Reusing
`outreach_bounce_kind` would record a bounce that never happened. The column is nullable with
no default, so existing rows are unaffected.

**Check `information_schema.column_privileges` before assuming an admin screen can write it** —
new columns on `businesses` have shipped broken three times for want of a column GRANT.

### Test strategy
`checkMailDomain` takes an injectable fetch, so every row of the decision table above is a
test with no network. Plus `domainOf` on malformed input, and a case asserting an inconclusive
result never produces a mark.

### Rollback
Revert the source; drop the column. The check is additive — removing it returns to sending
without a pre-check.

### Acceptance criteria
- [ ] Every row of the decision table is covered by a test
- [ ] An inconclusive lookup never writes `email_undeliverable_at`
- [ ] A DoH outage degrades to "skip this run", never to "mark everything dead"
- [ ] The new column is readable by the admin screens that show undeliverable state
- [ ] Full suite passes

---

## Cross-cutting

Sending volume is **not** changed by either phase. `outreach_config.daily_limit` stays at 5.
The enrichment batch (20/day) sends nothing — it reads websites.

Another session may be editing this repo (a second worktree exists). Commit by explicit
pathspec, never `git add -A`.
