-- ============================================================================
-- Expose `license_number` on public_business_listings.
--
-- Why: on 2026-11-06 Google had indexed 2 of the 553 submitted URLs — the
-- homepage and /directory — and zero of the 536 listing pages, five weeks
-- after the crawler head-tag fix shipped and was verified working. The pages
-- are crawled and declined, because all 536 are near-identical: no services,
-- no blurb and no website on any of them. 76699fc added the trade, which is
-- the first distinguishing fact. The CSLB licence number is the second, and
-- the stronger one — it is specific per listing, and it is checkable, which is
-- exactly what a homeowner wants and what a search engine treats as real
-- content rather than a template.
--
-- What is NOT exposed, deliberately:
--   * `license_status` — every published row reads 'ACTIVE', but
--     `license_expires_at` is NULL on all 536, so nothing records when that
--     status was last confirmed. Publishing "Active" from a status of unknown
--     age would be a trust claim the data cannot support. The number alone is
--     a fact ("this is the licence on file"); the status is a judgement.
--   * `license_expires_at` — all NULL, so it would render nothing.
--   * `classification` — the full CSLB class list is admin-facing; the listing
--     is filed under one trade (`vertical_slug`) and showing a second, wider
--     list next to it invites the two to disagree on the page.
--
-- A licence number is public record: CSLB publishes it, and it is printed on
-- contractors' advertising by law. Exposing it reveals nothing the state does
-- not already publish, and it lets a homeowner verify the listing themselves
-- at cslb.ca.gov rather than trusting this directory.
--
-- The view is recreated in full rather than altered: Postgres cannot add a
-- column to an existing view in place, and CREATE OR REPLACE requires the
-- existing columns to keep their names, types and order — so the new column
-- goes last and every prior column is reproduced verbatim from
-- `pg_get_viewdef` as it stood before this migration.
--
-- Rollback (restores the view exactly as it was before this migration):
--
--   CREATE OR REPLACE VIEW public.public_business_listings AS
--     SELECT id, business_name, slug, city, city_slug, owner_name, phone,
--            website_url, services, scraped_context, is_claimed,
--            CASE WHEN listing_tier = 'featured'::text
--                  AND (featured_until IS NULL OR featured_until > now())
--                 THEN 'featured'::text ELSE 'free'::text END AS listing_tier,
--            CASE WHEN listing_tier = 'featured'::text
--                  AND (featured_until IS NULL OR featured_until > now())
--                 THEN 0 ELSE 1 END AS tier_rank,
--            created_at, vertical_slug
--       FROM businesses
--      WHERE is_published = true AND archived_at IS NULL;
--
--   Dropping the column is safe for readers: the frontend renders the licence
--   only when it is present, so a rollback degrades the page rather than
--   breaking it.
-- ============================================================================

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
    vertical_slug,
    -- New. Nullable by nature: nothing requires a row to carry a licence, even
    -- though all 536 published rows do today.
    license_number
  FROM businesses
  WHERE is_published = true AND archived_at IS NULL;

-- The view's grants are not inherited from a CREATE OR REPLACE on all
-- platforms, so they are restated. anon and authenticated both read the public
-- directory; nothing writes through this view.
GRANT SELECT ON public.public_business_listings TO anon, authenticated;

COMMENT ON VIEW public.public_business_listings IS
  'Public, unauthenticated read of published, non-archived businesses. Omits the claim token and every email/outreach column. license_number is included deliberately — it is CSLB public record — while license_status is not, because license_expires_at is NULL everywhere and the status has no recorded age.';
