# Implementation Plan: Make the enrichment evidence worth trusting

## What prompted this
Four businesses sat in the review queue because "the phone on their website didn't match
their licence". Three of the four site phones were **(529) 411-7647**, **(942) 938-4556** and
**(532) 272-9582** — none are real US numbers. 529/942/532 are not area codes in service, and
411 can never be an exchange (N11 is reserved).

Operator's judgement, and it is the right one: a phone mismatch is weak evidence either way.
Contractors use tracking numbers, answering services and mobiles that were never filed with
CSLB. **A business whose site places it outside the service area is the real red flag.**

## Three defects

### 1. Any ten digits is treated as a phone number
`extractPhonesFromHtml` uses `/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g` — no
NANP validation and, worse, **no word boundaries**, so it can match ten digits out of the
middle of a longer run. Licence numbers, tracking codes and script literals become "phones".

The harm is not a false match — junk will not equal the CSLB number — it is that
`email_source_phone` shows the reviewer an invented number, making an honest business look
like the wrong one. It is actively misleading evidence, and it will do this to all 452
businesses still queued.

### 2. The phone decides everything
`resolveConfidence(phoneMatched)` — a phone match is the only route to `verified`. So the
weakest signal is the gate, and the strongest one (location) is not consulted at all.

### 3. Location is rarely even found
`extractAddressFromHtml` requires the exact shape `<City>, CA <zip>`. Only **8 of 27**
enriched businesses have any page address recorded. Reweighting toward a signal that is
missing two thirds of the time would just move everything into the review queue, so detection
has to improve alongside the rule.

## Changes

| File | Change |
| --- | --- |
| `_shared/emailEnrichment.ts` | NANP validation on extracted phones; `findPageLocation`; rewrite `resolveConfidence` |
| `enrich-business-email/index.ts` | Pass location + service area into the decision; store only plausible phones |
| `tests/unit/emailEnrichment.test.ts` | The real junk numbers as cases, plus the new rule |

### Phone plausibility
Reject unless: `+1`, area code `[2-9]` and not `N11`, exchange `[2-9]` and not `N11`, not all
one repeated digit, not the `555-01xx` fictional range. Word boundaries so a longer digit run
cannot donate a substring. The three real junk numbers above become the regression cases.

### Location detection
Accept `CA` or `California`, make the zip optional, and separately look for any service-area
city named on the page. Returns the reviewer-facing snippet, in-area cities found, and
out-of-area cities found in address-shaped text.

### The new rule, in order
1. Page places the business **outside** the service area and names no in-area city →
   `needs_review`. This overrides a phone match, per the operator's steer: an out-of-area
   address is the one thing genuinely worth stopping for.
2. Page names the business's own city → `verified`.
3. Page names some other service-area city → `verified` (a Tarzana site for an Encino licence
   is ordinary; both are covered).
4. No location found but the phone matches → `verified`. A genuine phone match is still real
   corroboration; it is just no longer the only door.
5. Otherwise → `needs_review`.

Every outcome carries a one-sentence reason, so the queue says *why* rather than leaving the
reviewer to infer it from a number.

`email_confidence` already permits `rejected`, and this deliberately does not use it. An
out-of-area address is a strong reason for a human to look, not grounds for the machine to
discard a business on its own.

## Rollback
Revert the two source files. No schema change — `resolveConfidence`'s outputs are the two
values already in use.

## Acceptance criteria
- [ ] The three real junk numbers are rejected; genuine numbers (incl. the 800 one found for
      Alpha Builders) still extract
- [ ] Ten digits inside a longer run are not treated as a phone
- [ ] Out-of-area location beats a phone match and sends the row to review
- [ ] In-area location verifies without needing a phone match
- [ ] Phone match still verifies when no location is found
- [ ] Every decision carries a human-readable reason
- [ ] Full suite passes
