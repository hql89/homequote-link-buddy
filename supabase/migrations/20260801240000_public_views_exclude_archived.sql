-- ============================================================================
-- Hide archived businesses from every public surface.
--
-- Verified before writing: anon has no SELECT policy on public.businesses at
-- all — RLS grants SELECT only to admins via is_admin(). Every public read
-- goes through these two views. So adding `archived_at IS NULL` here closes
-- all public paths at once, with no per-call-site auditing and no chance of
-- missing one.
--
-- Definitions are otherwise byte-identical to the previous versions; only the
-- WHERE clause changes.
--
-- Rollback: re-run these two CREATE OR REPLACE statements with the
-- `AND archived_at IS NULL` conjunct removed.
-- ============================================================================

CREATE OR REPLACE VIEW public.public_business_listings AS
  SELECT id,
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
           WHEN listing_tier = 'featured'::text
                AND (featured_until IS NULL OR featured_until > now())
           THEN 'featured'::text
           ELSE 'free'::text
         END AS listing_tier,
         CASE
           WHEN listing_tier = 'featured'::text
                AND (featured_until IS NULL OR featured_until > now())
           THEN 0
           ELSE 1
         END AS tier_rank,
         created_at,
         vertical_slug
    FROM businesses
   WHERE is_published = true
     AND archived_at IS NULL;

CREATE OR REPLACE VIEW public.public_directory_cities AS
  SELECT city,
         city_slug,
         count(*)::integer AS listing_count
    FROM businesses
   WHERE is_published = true
     AND archived_at IS NULL
   GROUP BY city, city_slug;
