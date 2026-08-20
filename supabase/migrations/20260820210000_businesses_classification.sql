-- ============================================================================
-- Carries the CSLB licence classification through to `businesses`.
--
-- WHY: 221 of 536 businesses hold multi-class licences — Lucy Asbestos
-- Abatement holds six (B, C10, C20, C22, C27, C36). The directory picks ONE
-- of those for `vertical_slug` so a listing can sit under one category, which
-- is correct for display. But the enrichment identity assessment was being
-- handed that single slug as though it were the whole licence, so on
-- 2026-08-20 it read an asbestos-abatement company as "licensed trade:
-- electrical", saw environmental services on its website, and reported a
-- mismatch. The verdict was reasonable given the input; the input was a
-- sixth of the truth.
--
-- `classification` already exists on ingest_queue and is discarded at the
-- ingest step. This carries it across and backfills what was dropped.
--
-- NOT a fix to vertical_slug: that mapping was checked across all 536 rows
-- and every one is correct against its CSLB class (C10 electrical, C36
-- plumbing, C20 HVAC, C27 landscaping, D49 tree service). Nothing here
-- changes how a listing is categorised.
--
-- Rollback:
--   ALTER TABLE public.businesses DROP COLUMN IF EXISTS classification;
-- ============================================================================

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS classification text;

-- Backfill by licence number, the stable key both tables share.
UPDATE public.businesses b
SET classification = q.classification
FROM public.ingest_queue q
WHERE q.license_number = b.license_number
  AND b.classification IS NULL
  AND q.classification IS NOT NULL;

-- Read-only for the client: nothing in the admin UI edits a licence class,
-- and the enrichment function writes under the service role. `authenticated`
-- already holds table-level SELECT on businesses, so no grant is needed to
-- read it — and deliberately none is added to write it.
