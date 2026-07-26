-- ============================================================================
-- `ON CONFLICT (license_number)` on ingest_queue failed with:
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification"
--
-- The index created in 20260726090000 is PARTIAL (WHERE license_number IS NOT
-- NULL). Postgres will only use a partial index as a conflict target if the
-- statement repeats the same predicate, which PostgREST's `onConflict`
-- parameter cannot express — so re-importing a CSLB export errored instead of
-- being the intended no-op.
--
-- The predicate was unnecessary: a plain UNIQUE index already permits any
-- number of NULLs, because Postgres treats NULLs as distinct.
--
-- Rollback: restore the partial index from the previous migration.
-- ============================================================================

DROP INDEX IF EXISTS public.ingest_queue_license_number_key;

CREATE UNIQUE INDEX IF NOT EXISTS ingest_queue_license_number_key
  ON public.ingest_queue (license_number);
