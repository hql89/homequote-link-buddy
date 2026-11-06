-- ============================================================================
-- Add a sixth trade: general contracting / remodeling.
--
-- Why now: the directory's five trades (electrical, plumbing, hvac,
-- landscaping, tree-service) all came from a CSLB class import, and every one
-- of the 536 listings is a single-class specialty contractor. A general
-- contractor doing remodels and additions has nowhere to sit, and "remodeling"
-- is what a homeowner planning work actually searches for — it is a bigger
-- intent than any of the five, not a gap at the edges.
--
-- The immediate occasion is the first manually-added listing (West Valley
-- Builders), but the category is not specific to it.
--
-- `icon_name` is 'Wrench', which is already registered in
-- src/lib/verticalIcons.ts ICON_MAP and was the only entry no vertical used,
-- so no frontend change is needed for the mark to render. The listing page and
-- head tags do need the trade's noun forms — that is a separate code change in
-- src/lib/routeMeta.ts, and until it lands this trade degrades to the generic
-- wording rather than rendering wrong (TRADE_NOUNS is a lookup with a null
-- fallback, never a direct index).
--
-- sort_order 5 puts it last in the existing sequence (1,1,2,3,4). It is not
-- given a lower number despite the broader intent, because reordering the five
-- established trades is a separate decision about the homepage.
--
-- Idempotent on slug so a re-run is harmless.
--
-- Rollback:
--   DELETE FROM public.verticals WHERE slug = 'general-contractor';
--   -- Safe only while no business row references it:
--   --   SELECT count(*) FROM public.businesses WHERE vertical_slug = 'general-contractor';
--   -- must be 0 first, otherwise those listings lose their trade and fall back
--   -- to the generic wording (they will not break).
-- ============================================================================

INSERT INTO public.verticals (
  slug,
  label,
  professional_label,
  professional_label_plural,
  service_types,
  is_active,
  sort_order,
  icon_name,
  hero_title,
  hero_description,
  meta_title,
  meta_description
)
VALUES (
  'general-contractor',
  'Remodeling & General Contracting',
  'general contractor',
  'general contractors',
  ARRAY[
    'Kitchen Remodeling',
    'Bathroom Remodeling',
    'Room Additions',
    'Whole-Home Renovation',
    'Flooring',
    'Drywall & Painting',
    'Decks & Patios',
    'Permits & Plans'
  ],
  true,
  5,
  'Wrench',
  'Remodeling & general contractors in the San Fernando Valley',
  'Planning a remodel or an addition? Compare licensed general contractors serving your city and call them directly.',
  'Remodeling & General Contractors | Valley Home Pros',
  'Licensed remodeling and general contractors across the San Fernando Valley. Call directly — no middleman, no tracking numbers.'
)
ON CONFLICT (slug) DO NOTHING;
