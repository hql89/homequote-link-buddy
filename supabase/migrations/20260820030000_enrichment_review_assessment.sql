-- ============================================================================
-- An advisory "is this the same business?" assessment for the enrichment
-- review queue.
--
-- WHY: enrich-business-email only auto-verifies on a CSLB phone match, and
-- everything else queues for a human. Working that queue by hand on
-- 2026-08-19 showed the phone is a poor deciding signal: of 8 rows, the 3
-- that were genuinely the right business ALL had non-matching phones (two
-- toll-free vanity numbers, one unlisted), and the 5 that were wrong were
-- wrong for reasons the phone never showed — a Utah builder, a UK
-- electrician, a Florida developer, a florist holding a landscaping licence,
-- and a retail LED shop. Name, location, licensed trade and services are what
-- actually decided each one. These columns hold a model's written read on
-- exactly that, so a person can skim it instead of opening every site.
--
-- WHAT THIS IS NOT: not a decision. Nothing reads these columns except the
-- admin UI rendering them for a human. They can never move a row out of the
-- review queue, and the enrichment function is forbidden from letting the
-- model write email, phone, or email_confidence — that separation is the
-- whole reason an advisory verdict is safe here (see
-- _shared/enrichmentAssessment.ts).
--
-- Rollback:
--   ALTER TABLE public.businesses
--     DROP COLUMN IF EXISTS email_review_verdict,
--     DROP COLUMN IF EXISTS email_review_notes,
--     DROP COLUMN IF EXISTS email_review_assessed_at;
-- ============================================================================

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS email_review_verdict text
    CHECK (email_review_verdict IN ('likely_match', 'likely_mismatch', 'unclear')),
  ADD COLUMN IF NOT EXISTS email_review_notes text,
  ADD COLUMN IF NOT EXISTS email_review_assessed_at timestamptz;

-- `authenticated` holds table-level SELECT on businesses (verified against
-- production before writing this), so the admin UI can read these the moment
-- they exist and no SELECT grant is needed.
--
-- UPDATE is column-scoped, however, and the review queue's Dismiss action
-- clears the discovered payload — the assessment describes an email that
-- Dismiss is throwing away, so leaving it behind would strand stale reasoning
-- against a row whose evidence is gone. That write needs these columns
-- granted or it dies with "permission denied for table businesses", the same
-- failure as 20260726230000, 20260729150000, 20260731130000 and
-- 20260814120000. Four occurrences is enough; granting it in the same
-- migration that adds the columns.

GRANT UPDATE (
  email_review_verdict,
  email_review_notes,
  email_review_assessed_at
) ON public.businesses TO authenticated;

-- No new RLS policy: the existing "Admins can publish businesses" UPDATE
-- policy is USING/WITH CHECK (is_admin()) with no column restriction, and RLS
-- does not scope by column. The GRANT above is the only missing layer.
