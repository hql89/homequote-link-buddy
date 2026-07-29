-- public_business_listings predates businesses.vertical_slug (added in the
-- prior migration), so the public directory pages could not read it even
-- though the column now exists. CREATE OR REPLACE VIEW only allows appending
-- columns at the end of the list — inserting vertical_slug in the middle (its
-- natural position next to is_claimed) fails with "cannot change name of view
-- column" because Postgres reads it as renaming everything after that point.
-- So it goes last instead, after created_at.

CREATE OR REPLACE VIEW public.public_business_listings AS
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
    WHEN listing_tier = 'featured' AND (featured_until IS NULL OR featured_until > now())
      THEN 'featured'
    ELSE 'free'
  END AS listing_tier,
  CASE
    WHEN listing_tier = 'featured' AND (featured_until IS NULL OR featured_until > now())
      THEN 0
    ELSE 1
  END AS tier_rank,
  created_at,
  vertical_slug
FROM public.businesses
WHERE is_published = true;

-- Rollback: re-run this CREATE OR REPLACE with the vertical_slug line removed.
