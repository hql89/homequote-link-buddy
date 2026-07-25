-- ============================================================================
-- Activate the dormant service categories for the Valley Home Pros directory.
--
-- Plumbing, HVAC, Landscaping and Electrical already existed in `verticals`,
-- fully configured (service_types, professional labels, icons) but sitting at
-- is_active = false. Meanwhile the footer advertised all four and the homepage
-- rendered its dropdown from a hardcoded tree-service-only constant, so they
-- were advertised and unselectable. Activating them fixes that and gives the
-- directory the multi-category surface a credible local portal needs.
--
-- Their copy predates two pivots: it still says "Santa Clarita" (this project
-- serves the San Fernando Valley) and "HomeQuoteLink" (retired in favour of
-- the Valley Home Pros master brand). Both are corrected here rather than left
-- to surface later on category pages.
--
-- Outbound prospecting stays focused on tree service; this is about the site
-- looking like the directory it claims to be, not about working every niche.
--
-- Rollback:
--   UPDATE public.verticals SET is_active = FALSE
--    WHERE slug IN ('plumbing','hvac','landscaping','electrical');
--   -- copy corrections are cosmetic and safe to leave in place
-- ============================================================================

-- Region and brand corrections across every vertical, including tree-service.
-- REPLACE() is a no-op where the strings don't appear, so this is safe to run
-- against rows that were already correct.
UPDATE public.verticals
SET
  hero_title       = REPLACE(REPLACE(hero_title,       'Santa Clarita', 'the San Fernando Valley'), 'HomeQuoteLink', 'Valley Home Pros'),
  hero_description = REPLACE(REPLACE(hero_description, 'Santa Clarita', 'the San Fernando Valley'), 'HomeQuoteLink', 'Valley Home Pros'),
  meta_title       = REPLACE(REPLACE(meta_title,       'Santa Clarita', 'San Fernando Valley'),     'HomeQuoteLink', 'Valley Home Pros'),
  meta_description = REPLACE(REPLACE(meta_description, 'Santa Clarita', 'the San Fernando Valley'), 'HomeQuoteLink', 'Valley Home Pros'),
  updated_at       = NOW()
WHERE
  hero_title       ILIKE '%Santa Clarita%' OR hero_title       ILIKE '%HomeQuoteLink%'
  OR hero_description ILIKE '%Santa Clarita%' OR hero_description ILIKE '%HomeQuoteLink%'
  OR meta_title       ILIKE '%Santa Clarita%' OR meta_title       ILIKE '%HomeQuoteLink%'
  OR meta_description ILIKE '%Santa Clarita%' OR meta_description ILIKE '%HomeQuoteLink%';

-- "the San Fernando Valley Valley" can result from copy that already read
-- "Santa Clarita Valley"; collapse the duplication.
UPDATE public.verticals
SET
  hero_title       = REPLACE(hero_title,       'the San Fernando Valley Valley', 'the San Fernando Valley'),
  hero_description = REPLACE(hero_description, 'the San Fernando Valley Valley', 'the San Fernando Valley'),
  meta_title       = REPLACE(meta_title,       'San Fernando Valley Valley',     'San Fernando Valley'),
  meta_description = REPLACE(meta_description, 'the San Fernando Valley Valley', 'the San Fernando Valley')
WHERE
  hero_title ILIKE '%Valley Valley%' OR hero_description ILIKE '%Valley Valley%'
  OR meta_title ILIKE '%Valley Valley%' OR meta_description ILIKE '%Valley Valley%';

-- Turn the four dormant categories on.
UPDATE public.verticals
SET is_active = TRUE, updated_at = NOW()
WHERE slug IN ('plumbing', 'hvac', 'landscaping', 'electrical');
