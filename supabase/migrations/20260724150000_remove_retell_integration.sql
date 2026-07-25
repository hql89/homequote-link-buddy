-- ============================================================================
-- Remove the Retell.ai integration.
--
-- Retell is not connected to this project, so the outbound AI voice demo and
-- the embedded web chat agent are dropped. What remains is the directory
-- itself: auto-generated listing pages, the cold-outreach email drip, the
-- owner claim flow, and quote capture.
--
-- The TCPA consent columns go with it: consent was collected solely to place
-- the demo call, and storing consent for a call that can never happen is worse
-- than not storing it.
-- ============================================================================

-- The view selects retell_agent_id, so it must be dropped before the column.
DROP VIEW IF EXISTS public.public_business_listings;

ALTER TABLE public.businesses
  DROP COLUMN IF EXISTS retell_agent_id,
  DROP COLUMN IF EXISTS retell_llm_id,
  DROP COLUMN IF EXISTS demo_call_id,
  DROP COLUMN IF EXISTS demo_call_status,
  DROP COLUMN IF EXISTS demo_call_requested_at,
  DROP COLUMN IF EXISTS demo_call_count,
  DROP COLUMN IF EXISTS has_consented_to_call,
  DROP COLUMN IF EXISTS consented_at,
  DROP COLUMN IF EXISTS consent_ip;

-- Recreate the public read surface without the Retell column. Still omits
-- claim_token and email — see the directory_demo_engine migration for why.
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
  created_at
FROM public.businesses
WHERE is_published = TRUE;

GRANT SELECT ON public.public_business_listings TO anon, authenticated;

COMMENT ON VIEW public.public_business_listings IS
  'Public, crawlable directory listings. Deliberately omits claim_token and email.';
