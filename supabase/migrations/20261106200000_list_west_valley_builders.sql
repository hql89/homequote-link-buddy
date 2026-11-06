-- ============================================================================
-- List West Valley Builders Inc. — the first manually-added business, and the
-- first in Woodland Hills.
--
-- Why this one, and why by hand: the owner controls wvbuild.com, so this is
-- the first real inbound-link opportunity. ENH-029 is the binding constraint
-- on the whole product — Search Console reports the listing pages as
-- "Discovered - currently not indexed", Last crawl N/A, "Referring page: None
-- detected". Google knows the URLs and has never fetched one. A link from an
-- established contractor site into a listing page is a path inward that does
-- not currently exist.
--
-- Depends on 20261106190000 (the `general-contractor` vertical). Applying this
-- first would leave `vertical_slug` pointing at a trade that does not exist —
-- not an error, since there is no FK, but the listing would render with the
-- generic wording and no trade badge.
--
-- ## Where each value came from
--
-- Everything here is from the business's own site (wvbuild.com, which
-- jcsuchiteconstruction.com redirects to), read 2026-11-06:
--   business_name  the site's own title and footer, "West Valley Builders Inc."
--   phone          "Call for a free estimate: 818-917-2197", stored E.164 to
--                  match the 536 CSLB-imported rows
--   website_url    the canonical host the other domain redirects to
--   services       their own navigation's service headings (Kitchens,
--                  Bathrooms, Interiors, Exteriors, Additions), written out as
--                  a homeowner would read them. Not invented, and not copied
--                  prose.
--   city           Woodland Hills, chosen by the owner. NOTE: the site lists
--                  service AREAS (Los Angeles, Santa Clarita, Woodland Hills,
--                  San Fernando), not an address — a service-area mention is
--                  not an address, the same rule the enrichment verdicts turn
--                  on. The city here is the owner's answer, not an inference,
--                  and it is the first of the seven cities that no CSLB import
--                  produced.
--
-- ## Deliberately NULL
--
--   license_number   Not printed anywhere on their site. CSLB name search
--                    returns seven "WEST VALLEY BUILDERS" variants; only
--                    #1020926 (North Hollywood) is Active and nothing ties it
--                    to this business. The owner chose to leave it off rather
--                    than publish an unconfirmed one. The listing page renders
--                    a null licence by omitting the block entirely.
--   license_status   Would be a claim with nothing behind it (see ENH-028).
--   scraped_context  Their About text is theirs, and duplicating it here would
--                    be both a copyright question and duplicate content
--                    competing with their own page. The listing's fallback
--                    copy names the trade and city, which reads correctly.
--   owner_name       NULL on all 536 existing rows and rendered nowhere.
--   email            Not collected; this row is not an outreach target. It is
--                    created already `is_claimed = true`, so the drip would
--                    skip it regardless.
--
-- `source = 'manual'` distinguishes it from the 536 `'cslb'` rows, so a future
-- re-import or audit does not mistake it for imported data.
--
-- Idempotent on the existing `businesses_city_slug_slug_key` unique index.
--
-- Rollback:
--   DELETE FROM public.businesses
--    WHERE city_slug = 'woodland-hills' AND slug = 'west-valley-builders-inc';
--   -- Removing it also removes the Woodland Hills city page, which
--   -- `public_directory_cities` derives by grouping published rows on city.
-- ============================================================================

INSERT INTO public.businesses (
  business_name,
  slug,
  city,
  city_slug,
  phone,
  website_url,
  services,
  vertical_slug,
  is_published,
  is_claimed,
  claimed_at,
  listing_tier,
  source
)
VALUES (
  'West Valley Builders Inc.',
  'west-valley-builders-inc',
  'Woodland Hills',
  'woodland-hills',
  '+18189172197',
  'https://www.wvbuild.com/',
  '["Kitchen Remodeling","Bathroom Remodeling","Interior Renovations","Exterior Renovations","Room Additions"]'::jsonb,
  'general-contractor',
  true,
  -- Claimed on creation: the owner controls this business's website, so the
  -- listing is not an unclaimed scrape awaiting outreach. This also keeps it
  -- out of every outreach query, which filter on is_claimed.
  true,
  now(),
  'free',
  'manual'
)
ON CONFLICT (city_slug, slug) DO NOTHING;
