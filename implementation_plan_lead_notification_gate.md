# Implementation plan — make the lead-notification gate tell the truth

Addresses **ENH-020**, plus a second defect found while measuring it.

---

## Plain summary

**What this does.** When a homeowner fills in the quote form on a listing, we
email that business. Right now two things can go wrong quietly, and this fixes
both so that nothing ever vanishes without a trace.

**Problem one — the one you asked about.** The Enrichment screen has a "Needs
review" queue. Its own words say "nobody has confirmed this is the right
business yet." That reads like those addresses are being held back. They are
not. An address sitting in that queue was scraped off a website that might
belong to an entirely different company, and it is wired up to receive a
homeowner's name and phone number the moment someone submits the form. The
queue looks like a safety net and is actually a to-do list.

**Problem two — found while checking the first, and worse.** West Valley
Builders is the only listing a homeowner can currently submit a request to. It
has no email address on file. If someone submits that form today, the request
is saved, nobody is emailed, and **nothing anywhere records that no one was
emailed**. It does not show up in the "notifications skipped" count on your
Overview, because that count only covers addresses we knew were dead. A real
customer enquiry would sit in the database and no one would know it existed.

**Does this already exist?** No. The skip machinery exists and works, but it
only recognises two reasons to skip — a bounced address and an opted-out
business. Neither of these two cases is one of them.

**Is this the best way?** The backlog proposed two options: make the review
status actually block sending, or leave sending alone and reword the screen so
it stops implying protection. The backlog guessed the second. **The numbers say
the first.** I counted: exactly **6** businesses are in the review queue. The
worry about option one — that it would silently cut off mail to a large number
of businesses — is a worry about 6 rows, and the skip is recorded and counted
rather than silent. So we block the send, and the screen's existing wording
becomes true instead of needing to be walked back.

**Risk.** Very low. Today **zero** businesses can receive a lead notification
at all: only one listing is claimed and it has no address. So this change
cannot break a working flow, because there is no working flow yet to break.
That is also the reason to do it now rather than after traffic arrives.

**How hard to undo.** Trivial. No database changes, no data is modified. It is
a few lines in two code files plus wording; reverting the commit restores
today's behaviour exactly.

**Who does the work.** Me, entirely. Nothing needed from you after approval.

**How you will know it worked.** Two ways. Automated tests cover each skip
reason, so a future change that removes one fails the build. And on the admin
Overview, the "notifications skipped" figure becomes the running proof: every
request that did not reach a business is counted there with a reason, instead
of some of them disappearing.

---

## Scope

In scope:

1. Add "the address has not been confirmed" as a skip reason.
2. Add "this business has no address on file" as a skip reason.
3. Make the Needs review screen state the consequence out loud.
4. Regression tests for every skip reason, including the two new ones.

Explicitly **not** in scope:

- Changing which businesses outreach emails to. `send-outreach-drip` already
  filters on `email_confidence = 'verified'` at query time and is correct.
- Changing enrichment's own judgement, thresholds or verdicts.
- Any schema change. `email_confidence` already exists and is already written.

---

## Files to change, and why

### 1. `supabase/functions/_shared/directory.ts`

`EmailGateFields` gains `email_confidence: string | null` and `email: string |
null`. `emailSkipReason()` gains two checks.

Order matters, most-specific first, so the recorded reason is the most useful
one: undeliverable → suppressed → unconfirmed → no address.

**The gate must key on the explicit uncertain values, not on "anything that is
not `verified`".** 494 published businesses have `email_confidence = NULL`
because they have never been enriched. NULL means "we have not looked", which
is not the same as "we looked and are unsure" — and a future address typed in
by hand by the owner, which is the most trustworthy kind there is, would also
arrive as NULL. Gating on `!== 'verified'` would silently suppress exactly the
addresses we trust most. So: skip on `needs_review` and on `rejected`
(defensive; rejected rows have their email cleared, so it should be
unreachable), and let NULL through.

### 2. `supabase/functions/submit-directory-lead/index.ts`

Add `email_confidence` to the `.select(...)` on the business lookup.

**This is the step that silently breaks the whole change if it is missed.** The
field would be `undefined`, the new check would never match, and the gate would
read as working while doing nothing. `strict: false` is on project-wide, so
`tsc` cannot catch it — the type is erased. The test in §4 asserts the selected
column list as a string for exactly this reason.

Then move the "no address on file" case from the implicit `else if
(business.email)` fall-through into the skip path, so it is recorded like every
other reason rather than being a branch that quietly does nothing.

### 3. `src/pages/admin/Enrichment.tsx`

One added sentence under the "Needs review" heading, saying that quote requests
for these businesses are held until confirmed or dismissed, and naming the two
buttons as the actions that resolve it. No behaviour change, no new component.

### 4. `tests/unit/emailSkipReason.test.ts` (exists)

Extend. One case per skip reason, one for each value that must NOT skip
(`verified`, and `NULL` — the 494-row case above), and one asserting the
precedence order. Plus a test reading `submit-directory-lead/index.ts` and
asserting its select list contains `email_confidence`, which is the only thing
that can catch the §2 failure mode.

---

## Test strategy

- `npx vitest run` — full suite must stay green; baseline is measured
  immediately before the change rather than taken from any written-down number.
- `npx tsc --noEmit -p tsconfig.app.json` — expected to pass, and expected to
  prove nothing about nullability. Not treated as evidence of safety.
- `npx eslint` on the changed files.
- `npm run build`.
- Manual check of the Enrichment screen's wording against what the code now
  does, by reading the rendered page, not the source.

## Database migrations

**None.** No column is added, altered or backfilled. No row is modified.

## Rollback

`git revert` of the single commit. There is no data change to unwind and no
deploy coupling: the edge function and the admin page can be reverted
independently if only one of them is at fault.

## Acceptance criteria

1. A lead submitted for a business whose `email_confidence` is `needs_review`
   does not send an email, and writes a `notify_skipped_reason` naming the
   unconfirmed address as the cause.
2. A lead submitted for a business with no address on file does not send an
   email, and writes a `notify_skipped_reason` saying so — it is no longer
   possible for a request to pass through with no record of why nobody was
   told.
3. A business with `email_confidence = 'verified'` is unaffected.
4. A business with `email_confidence = NULL` and a real address is unaffected.
5. `submit-directory-lead` selects `email_confidence`, asserted by a test.
6. The Needs review screen states that requests are held, and names the buttons
   that resolve it.
7. Full test suite green; no new eslint errors; build succeeds.
8. The Overview "notifications skipped" count includes the two new reasons.
