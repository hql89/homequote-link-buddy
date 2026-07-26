-- ============================================================================
-- Business ingestion engine — staging queue + license fields.
--
-- The directory is empty, which blocks outreach: the cold email says "I added
-- your business", and a click-through to an empty directory kills the pitch.
--
-- Source is the CSLB contractor licence database (public, free, legal to
-- store, and authoritative). Google Maps scraping is against Google's ToS, and
-- the Places API forbids retaining most content beyond ~30 days, which makes
-- it unusable as the system of record for permanent listing pages.
--
-- Design: the statewide CSLB file is far too large to parse inside a Deno edge
-- function, so the heavy parse happens once in the browser and rows land in
-- `ingest_queue`. A rate-limited worker then drains that queue daily. This also
-- makes the engine source-agnostic — any CSV feeds the same pipe.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.ingest_queue;
--   ALTER TABLE public.businesses
--     DROP COLUMN IF EXISTS license_number,
--     DROP COLUMN IF EXISTS license_status,
--     DROP COLUMN IF EXISTS license_expires_at,
--     DROP COLUMN IF EXISTS source;
--   DELETE FROM public.admin_settings WHERE setting_key = 'ingest_config';
-- Additive only; nothing pre-existing is modified.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- businesses: licence provenance
--
-- Deliberately NO street address column. CSLB's address is a *mailing* address
-- and for a contractor it is frequently their home. Only the city is kept, and
-- the public view has never exposed an address.
-- ---------------------------------------------------------------------------
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS license_number    TEXT,
  ADD COLUMN IF NOT EXISTS license_status    TEXT,
  ADD COLUMN IF NOT EXISTS license_expires_at DATE,
  ADD COLUMN IF NOT EXISTS source            TEXT NOT NULL DEFAULT 'manual';

COMMENT ON COLUMN public.businesses.license_number IS
  'CSLB licence number. Natural dedupe key for ingestion, and the basis for a verifiable "licensed" claim.';
COMMENT ON COLUMN public.businesses.source IS
  'Where the row came from: manual | cslb | places.';

-- Dedupe key. Partial so the many manually-created rows without a licence are
-- unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS businesses_license_number_key
  ON public.businesses (license_number)
  WHERE license_number IS NOT NULL;

-- ---------------------------------------------------------------------------
-- ingest_queue — candidates awaiting ingestion
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ingest_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  source          TEXT NOT NULL DEFAULT 'cslb',
  license_number  TEXT,
  business_name   TEXT NOT NULL,
  city            TEXT,
  phone           TEXT,
  classification  TEXT,
  vertical_slug   TEXT,

  -- The original row, kept for audit: if a listing is ever disputed we can show
  -- exactly what the public record said. Admin-only, never public.
  raw JSONB NOT NULL DEFAULT '{}'::JSONB,

  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'ingested', 'skipped', 'failed')),
  skip_reason TEXT,
  business_id UUID REFERENCES public.businesses(id) ON DELETE SET NULL,

  processed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Re-importing the same CSLB export must not enqueue duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS ingest_queue_license_number_key
  ON public.ingest_queue (license_number)
  WHERE license_number IS NOT NULL;

-- Worker scan: oldest pending first.
CREATE INDEX IF NOT EXISTS ingest_queue_status_created_idx
  ON public.ingest_queue (status, created_at);

-- Same posture as `businesses` and `directory_leads`: writes happen only in
-- edge functions under the service role; admins may read. Anon gets nothing —
-- this table holds contractors' mailing addresses from the raw CSLB row.
ALTER TABLE public.ingest_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ingest_queue FROM anon, authenticated;

DROP POLICY IF EXISTS "Admins can read ingest queue" ON public.ingest_queue;
CREATE POLICY "Admins can read ingest queue"
  ON public.ingest_queue
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

GRANT SELECT ON public.ingest_queue TO authenticated;

COMMENT ON TABLE public.ingest_queue IS
  'Staging area for candidate businesses. Drained daily by process-ingest-queue at an admin-configurable rate.';

-- ---------------------------------------------------------------------------
-- Engine configuration, editable from admin without a deploy.
-- ---------------------------------------------------------------------------
INSERT INTO public.admin_settings (setting_key, setting_value)
VALUES (
  'ingest_config',
  jsonb_build_object(
    'daily_limit', 25,
    'enabled', true,
    'cities', jsonb_build_array(
      'Sherman Oaks', 'Encino', 'Studio City', 'Tarzana', 'Valley Village', 'Toluca Lake'
    )
  )
)
ON CONFLICT (setting_key) DO NOTHING;
