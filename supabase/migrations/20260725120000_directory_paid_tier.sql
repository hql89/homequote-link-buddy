-- ============================================================================
-- Directory paid tier — schema foundation.
--
-- Replaces the Retell.ai "lease an AI voice agent" upsell (removed in
-- 20260724150000) with a paid listing tier. A claimed listing is free forever;
-- `featured` buys priority placement on the city index, a Featured badge, and
-- the preferred-time field on the quote form.
--
-- Deliberately NOT reusing the "Verified owner" badge for the paid tier. That
-- badge is tied to `is_claimed` and is free — it tells a homeowner the business
-- confirmed the listing is theirs. Selling it would turn a trust signal into a
-- pay-to-play signal, which is exactly the perception the claim flow was built
-- to avoid.
--
-- Additive only. Rollback:
--   DROP INDEX IF EXISTS public.businesses_city_tier_idx;
--   ALTER TABLE public.businesses
--     DROP COLUMN IF EXISTS listing_tier,
--     DROP COLUMN IF EXISTS featured_until;
--   -- then recreate the view from 20260724150000_remove_retell_integration.sql
-- ============================================================================

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS listing_tier TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS featured_until TIMESTAMPTZ;

-- Guards against a typo'd tier silently disabling every gate that compares
-- against 'featured'.
ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_listing_tier_check;
ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_listing_tier_check
  CHECK (listing_tier IN ('free', 'featured'));

COMMENT ON COLUMN public.businesses.listing_tier IS
  'Billing tier. Set by the Stripe webhook once payments ship; until then only by an admin.';
COMMENT ON COLUMN public.businesses.featured_until IS
  'Subscription period end. NULL means no expiry (admin-comped). A lapsed subscription reverts to free by expiry, so a missed webhook cannot leave a listing featured forever.';

-- Backs the city index: WHERE city_slug = ? AND is_published ORDER BY tier.
CREATE INDEX IF NOT EXISTS businesses_city_tier_idx
  ON public.businesses (city_slug, listing_tier)
  WHERE is_published = TRUE;

-- ---------------------------------------------------------------------------
-- Recreate the public view with the effective tier.
--
-- The view resolves expiry itself rather than exposing the raw column, so no
-- caller can accidentally treat an expired subscription as still featured.
-- Every consumer sees one authoritative answer.
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
  CASE
    WHEN listing_tier = 'featured' AND (featured_until IS NULL OR featured_until > NOW())
      THEN 'featured'
    ELSE 'free'
  END AS listing_tier,
  -- Explicit sort key for the city index. Ordering by `listing_tier` directly
  -- would happen to work today ('featured' < 'free' lexically) and break
  -- silently the moment a tier is added that doesn't sort correctly.
  CASE
    WHEN listing_tier = 'featured' AND (featured_until IS NULL OR featured_until > NOW())
      THEN 0
    ELSE 1
  END AS tier_rank,
  created_at
FROM public.businesses
WHERE is_published = TRUE;

GRANT SELECT ON public.public_business_listings TO anon, authenticated;

COMMENT ON VIEW public.public_business_listings IS
  'Public, crawlable directory listings. Deliberately omits claim_token and email. listing_tier is the EFFECTIVE tier — an expired featured_until reads as free.';

-- ---------------------------------------------------------------------------
-- City index. PostgREST cannot express SELECT DISTINCT, and the alternative --
-- fetching every listing and de-duplicating in the browser -- would ship the
-- whole directory to the client just to render a city list.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.public_directory_cities;
CREATE VIEW public.public_directory_cities AS
SELECT
  city,
  city_slug,
  COUNT(*)::INT AS listing_count
FROM public.businesses
WHERE is_published = TRUE
GROUP BY city, city_slug;

GRANT SELECT ON public.public_directory_cities TO anon, authenticated;

COMMENT ON VIEW public.public_directory_cities IS
  'Distinct cities with at least one published listing, for the /directory index.';
