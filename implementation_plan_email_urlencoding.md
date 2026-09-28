# Plan: Percent-encoded text is being captured as part of an email address

## Plain summary

**What happened.** The first two emails under the new copy went out yesterday. One reached its
recipient. The other was addressed to `%20info@lushgardensinc.com` and bounced immediately —
that `%20` is web shorthand for a space, picked up from the contractor's own web page and
treated as part of their address.

**What it does.** Strips that encoding before an address is stored, and rejects anything that
still doesn't look like an address afterwards.

**Does it already exist?** No. The address scanner allows `%` because it is a legal character
in an email address — true in general, but wrong here, where it is encoding rather than a
literal.

**Is it the best way?** Yes, and it is the narrow one. Addresses written inside a `mailto:`
link are percent-encoded *by definition*, so decoding them is reading them correctly rather
than guessing. An address that fails a strict check after decoding is discarded rather than
repaired — inventing a plausible address for a stranger is worse than finding none.

**Risk.** Low, and it fails in the safe direction: a rejected address means a business goes
unenriched, never a wrong address emailed. One business is currently affected out of 28.

**How hard to undo.** One file, revert and redeploy. The data repair is a single row.

**Who does the work.** Me, except two things needing your say-so: deploying, and correcting
the one stored address.

**How you'll know it worked.** The next enrichment run stores no address containing `%`, and
Lush Gardens can be emailed on a corrected address.

---

## Root cause

`extractEmailsFromHtml` in `_shared/emailEnrichment.ts`:

```js
const mailtoRe = /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
```

`%` sits in the local-part character class because it is legal in an email address. But a
`mailto:` URI is percent-*encoded*: `mailto:%20info@…` means `mailto: info@…` with a leading
space, which authors leave in by accident constantly. The regex takes `%20info` as the local
part verbatim. The plain-text branch below it has the same hole for literal page text.

Confirmed live: `businesses.email = '%20info@lushgardensinc.com'`, `email_confidence =
'verified'`, emailed 2026-09-27 15:00:08, bounced 15:03:24.

It is the only malformed address among 28 — checked, not assumed — so this is one bad row,
not a silent epidemic. But the scanner will keep producing them across the 449 still queued.

## Changes

| File | Change |
| --- | --- |
| `supabase/functions/_shared/emailEnrichment.ts` | Percent-decode a candidate, trim, then validate strictly before accepting |
| `tests/unit/emailEnrichment.test.ts` | The real address as a regression case, plus decode/reject cases |
| migration (pending approval) | Correct the one stored address and clear its bounce flags |

Decoding is wrapped — `decodeURIComponent` throws on malformed input, and a throw here must
mean "discard this candidate", never "abort the run".

## Test strategy
Pure function, existing file. Cases: `mailto:%20info@x.com` yields `info@x.com`; a literal
`%20info@x.com` in page text is rejected rather than silently repaired (there is no mailto
context to justify decoding it); `%2B` decodes to a legal `+` and is kept; malformed
percent-escapes are discarded without throwing; ordinary addresses are unaffected.

Baseline before: 70 files / 745 tests (measured, not quoted).

## Rollback
Revert the one source file and redeploy. The data repair is reversible by restoring the
`%20` prefix and the bounce timestamps, though there is no reason to.

## Acceptance criteria
- [ ] `mailto:%20info@lushgardensinc.com` yields `info@lushgardensinc.com`
- [ ] Anything not a valid address after decoding is discarded, not stored
- [ ] A malformed escape cannot throw out of the extractor
- [ ] No existing extraction behaviour changes
- [ ] Full suite green
