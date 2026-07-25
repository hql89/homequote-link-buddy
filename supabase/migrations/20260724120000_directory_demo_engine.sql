-- ============================================================================
-- Lead-to-Page & Retell.ai AI Agent Demo Engine
-- Creates the `businesses` directory table, a claim-token-safe public view,
-- and the outreach/demo-call tracking columns.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Core identity
  business_name TEXT NOT NULL,
  slug TEXT NOT NULL,
  city TEXT NOT NULL,
  city_slug TEXT NOT NULL,
  owner_name TEXT,

  -- Contact
  phone TEXT,
  email TEXT,
  website_url TEXT,

  -- Content
  services JSONB NOT NULL DEFAULT '[]'::JSONB,
  scraped_context TEXT,

  -- Claim + consent lifecycle
  is_claimed BOOLEAN NOT NULL DEFAULT FALSE,
  claimed_at TIMESTAMPTZ,
  claim_token UUID NOT NULL DEFAULT gen_random_uuid(),
  has_consented_to_call BOOLEAN NOT NULL DEFAULT FALSE,
  consented_at TIMESTAMPTZ,
  consent_ip TEXT,

  -- Retell.ai config
  retell_agent_id TEXT,
  retell_llm_id TEXT,
  demo_call_id TEXT,
  demo_call_status TEXT,
  demo_call_requested_at TIMESTAMPTZ,
  demo_call_count INTEGER NOT NULL DEFAULT 0,

  -- Outreach drip tracking
  outreach_email_1_sent_at TIMESTAMPTZ,
  outreach_email_2_sent_at TIMESTAMPTZ,
  outreach_paused BOOLEAN NOT NULL DEFAULT FALSE,

  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A slug only has to be unique within its city, since the route is
-- /directory/:city_slug/:slug
CREATE UNIQUE INDEX IF NOT EXISTS businesses_city_slug_slug_key
  ON public.businesses (city_slug, slug);

CREATE UNIQUE INDEX IF NOT EXISTS businesses_claim_token_key
  ON public.businesses (claim_token);

-- Drip worker scans for unsent outreach ordered by creation time.
CREATE INDEX IF NOT EXISTS businesses_outreach_scan_idx
  ON public.businesses (outreach_paused, outreach_email_1_sent_at, outreach_email_2_sent_at, created_at);

CREATE INDEX IF NOT EXISTS businesses_email_idx ON public.businesses (email);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_businesses_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS businesses_set_updated_at ON public.businesses;
CREATE TRIGGER businesses_set_updated_at
  BEFORE UPDATE ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.set_businesses_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- SECURITY MODEL: `claim_token` is a bearer credential — anyone holding it can
-- claim the listing and trigger an outbound call. It must therefore NEVER be
-- readable by the public. Postgres RLS cannot restrict individual columns, so
-- anon/authenticated get NO access to this base table at all. Public reads go
-- through the `public_business_listings` view below, which omits the token.
--
-- All writes (ingest, claim, consent, call status) happen exclusively in edge
-- functions using the service role key, which bypasses RLS. There are
-- deliberately no INSERT/UPDATE/DELETE policies.
-- ---------------------------------------------------------------------------
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.businesses FROM anon, authenticated;

-- Admins (already-established pattern in this project) may read the full row.
DROP POLICY IF EXISTS "Admins can read businesses" ON public.businesses;
CREATE POLICY "Admins can read businesses"
  ON public.businesses
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

GRANT SELECT ON public.businesses TO authenticated;

-- ---------------------------------------------------------------------------
-- Public listing view — every column EXCEPT claim_token and consent metadata.
-- Owned by the migration role, so it bypasses RLS on the base table (this is
-- intentional: directory listings are public content and must be crawlable).
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.public_business_listings;
CREATE VIEW public.public_business_listings AS
SELECT
  id,
  business_name,
  slug,
  city,
  city_slug,
  owner_name,
  phone,
  website_url,
  services,
  scraped_context,
  is_claimed,
  retell_agent_id,
  created_at
FROM public.businesses
WHERE is_published = TRUE;

GRANT SELECT ON public.public_business_listings TO anon, authenticated;

COMMENT ON VIEW public.public_business_listings IS
  'Public, crawlable directory listings. Deliberately omits claim_token, email, and consent columns.';

-- ============================================================================
-- directory_leads — quote requests captured on a listing page, either from the
-- "Request a Free Quote" form or from the Retell chat agent's booking tool.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.directory_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,

  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  message TEXT,
  preferred_time TEXT,

  -- 'quote_form' | 'chat'
  source TEXT NOT NULL DEFAULT 'quote_form',
  ip_address TEXT,
  notified_at TIMESTAMPTZ,
  notify_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS directory_leads_business_created_idx
  ON public.directory_leads (business_id, created_at DESC);

-- Backs the submission rate-limit window scans.
CREATE INDEX IF NOT EXISTS directory_leads_phone_created_idx
  ON public.directory_leads (phone, created_at DESC);

CREATE INDEX IF NOT EXISTS directory_leads_ip_created_idx
  ON public.directory_leads (ip_address, created_at DESC);

-- Same model as `businesses`: writes happen only in edge functions under the
-- service role. Anon must never read other people's contact details.
ALTER TABLE public.directory_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.directory_leads FROM anon, authenticated;

DROP POLICY IF EXISTS "Admins can read directory leads" ON public.directory_leads;
CREATE POLICY "Admins can read directory leads"
  ON public.directory_leads
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

GRANT SELECT ON public.directory_leads TO authenticated;
