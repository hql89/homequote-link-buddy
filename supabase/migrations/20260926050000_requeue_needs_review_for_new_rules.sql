-- Re-queue the review pile so it is judged by the new rules.
--
-- These rows were assessed when a phone mismatch was the only thing standing
-- between a business and `verified`, and when the phone shown as "found on
-- their site" could be any ten digits on the page. Three of the four carried
-- numbers that cannot be dialled — (529) 411-7647, (942) 938-4556,
-- (532) 272-9582 — presented to a reviewer beside the genuine licence
-- number. The evidence in the queue is not just weak, it is wrong.
--
-- Clearing `enriched_at` is all that is needed: the candidate query selects
-- on `enriched_at is null`, oldest first, and these are the oldest published
-- rows in the directory, so they return to the front of the queue.
--
-- Deliberately narrow:
--   • Only `needs_review`. Rows already `verified` matched a real phone, and
--     a real match still verifies under the new rule, so re-running them
--     would spend Perplexity calls to reach the same answer.
--   • Only `enriched_at` is cleared. Wiping email/email_source_* first would
--     lose a genuine address if the re-run happened to find no website that
--     day; the run overwrites them on success anyway.

update public.businesses
   set enriched_at = null
 where email_confidence = 'needs_review';

-- Rollback: none needed. Re-enrichment is idempotent — the worst case is the
-- rows are assessed again and land where they already were.
