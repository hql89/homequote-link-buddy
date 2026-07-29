-- businesses had no vertical/trade information at all: no vertical column, and
-- the ingestion worker inserted `services: []` unconditionally. Every one of
-- the 536 CSLB-ingested rows has an empty services array today.
--
-- ingest_queue.vertical_slug already holds the correct value, derived from the
-- CSLB classification at import time — it was simply never carried across into
-- businesses on insert. This adds the column, backfills existing rows from the
-- queue via the licence number (their natural join key, unique and present on
-- every row), and the worker is updated in the same change to write it going
-- forward.

ALTER TABLE public.businesses
  ADD COLUMN vertical_slug TEXT REFERENCES public.verticals(slug);

-- Index for the directory pages, which filter listings by vertical.
CREATE INDEX IF NOT EXISTS idx_businesses_vertical_slug ON public.businesses(vertical_slug);

UPDATE public.businesses b
SET vertical_slug = q.vertical_slug
FROM public.ingest_queue q
WHERE q.license_number = b.license_number
  AND b.vertical_slug IS NULL
  AND q.vertical_slug IS NOT NULL;

-- Rollback:
--   ALTER TABLE public.businesses DROP COLUMN vertical_slug;
