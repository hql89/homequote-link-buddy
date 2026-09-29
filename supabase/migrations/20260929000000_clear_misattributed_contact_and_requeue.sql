-- ============================================================================
-- Remove a stranger's email from a contractor's record, and re-queue the two
-- rows the new off-domain rule would now judge differently.
--
-- Background. `enrich-business-email` used to store `emails[0]` — first in
-- document order, which is mailto: links before the plain-text sweep. On
-- capitolplumbingca.com that was a "site by" footer credit, so
-- micah@micahrich.com was stored as Capitol Plumbing & Rooter Inc's contact and
-- received cold outreach on 2026-08-21 and 2026-08-25. The code is fixed
-- (cfce10b, refined a6c14c0, deployed as enrich-business-email v14): an address
-- on another company's domain can no longer reach `verified`.
--
-- That fix is forward-only. Enrichment selects on `enriched_at is null`, so it
-- never revisits a row it has already processed — these two rows keep their old
-- verdicts until something moves them.
--
-- WHY CLEARING THE ADDRESS, NOT JUST FLAGGING IT. `email_confidence` is not
-- consulted by anything that sends. `emailSkipReason()`
-- (supabase/functions/_shared/directory.ts:107) gates only on
-- `email_undeliverable_at` and `outreach_suppressed_at`, so a row left at
-- 'needs_review' still receives homeowner quote-request notifications. Marking
-- it for review would show as handled on /admin/enrichment and change nothing:
-- an uninvolved third party would still be emailed a homeowner's name and phone
-- number. Clearing the address is the only thing that closes that.
--
-- The columns cleared below are exactly the set `reviewEnrichedEmail(id,
-- 'rejected')` clears from Admin → Enrichment. This is that existing action,
-- applied to a row that never reached the review queue because it was filed as
-- `verified`.
--
-- Mr Pipe's address is deliberately NOT cleared. plumbingmrpipe.com against a
-- site at mrpipeplumbing.co is a near-variant, not another company, and the
-- stored evidence shows that domain appearing in the site's own text
-- ("plumbingmrpipe.com Studio City, CA"). It has never been mailed. Deleting a
-- probably-correct address to satisfy a rule would lose real information; the
-- re-queue below lets a re-run decide with the page in front of it.
--
-- Re-queueing by clearing `enriched_at` follows 20260926050000, three days ago,
-- for the same reason: a rule changed, so rows judged under the old rule go back
-- to be judged again. That migration deliberately spared `verified` rows on the
-- grounds that "a real match still verifies under the new rule" — which is no
-- longer true for these two, and is why they are named here. Candidates are
-- ordered `created_at` ascending, and both are among the oldest published rows,
-- so they return near the front rather than behind the 436-row backlog.
--
-- Note the daily enrichment job has failed every morning since 2026-08-28 for a
-- missing Vault secret (ENH-009), so the re-queue takes effect on the next
-- manual "Run now" from Admin → Enrichment, not overnight. The address removal
-- below takes effect immediately and does not depend on it.
--
-- ROLLBACK (exact values as of 2026-09-29, before this ran):
--   UPDATE public.businesses SET
--     email = 'micah@micahrich.com',
--     email_source_url = 'https://capitolplumbingca.com/',
--     email_source_phone = NULL,
--     email_source_address = NULL,
--     email_confidence = 'verified',
--     email_review_verdict = NULL,
--     email_review_notes = NULL,
--     email_review_assessed_at = NULL,
--     enriched_at = '2026-07-31 14:12:51.586+00'
--   WHERE id = '311cbbb7-7189-40aa-ba55-00edecb91f17';
--
--   UPDATE public.businesses
--      SET enriched_at = '2026-09-26 22:41:13.434+00'
--    WHERE id = 'a88cf54f-76bc-4630-8e60-ce07bd6db785';
--
-- Restoring it would put a stranger's address back on a public listing, so this
-- rollback exists for completeness, not as something to reach for.
-- ============================================================================

-- ── 1. Capitol Plumbing & Rooter Inc: remove the misattributed contact ──────
--
-- Addressed by id rather than by email so this cannot widen if another row ever
-- carries the same address. The email predicate is kept as a guard: if the row
-- has already been corrected by hand, this updates nothing rather than
-- overwriting a good address with NULL.
UPDATE public.businesses
   SET email                    = NULL,
       email_source_url         = NULL,
       email_source_phone       = NULL,
       email_source_address     = NULL,
       email_confidence         = NULL,
       -- The assessment reasons ABOUT evidence being cleared on the lines
       -- above. Left behind it would be a verdict with nothing to verdict on,
       -- and would resurface, stale, when this row is re-enriched.
       email_review_verdict     = NULL,
       email_review_notes       = NULL,
       email_review_assessed_at = NULL
 WHERE id = '311cbbb7-7189-40aa-ba55-00edecb91f17'
   AND email = 'micah@micahrich.com';

-- ── 2. Re-queue both rows for assessment under the new rule ────────────────
--
-- Only `enriched_at` is cleared. Wiping Mr Pipe's email first would lose a
-- probably-genuine address if the re-run happened to find no website that day;
-- a successful run overwrites it anyway. Same reasoning as 20260926050000.
UPDATE public.businesses
   SET enriched_at = NULL
 WHERE id IN (
   '311cbbb7-7189-40aa-ba55-00edecb91f17',  -- Capitol Plumbing & Rooter Inc
   'a88cf54f-76bc-4630-8e60-ce07bd6db785'   -- Mr Pipe Plumbing And Rooter
 );
