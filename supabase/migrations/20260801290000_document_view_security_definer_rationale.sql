-- ============================================================================
-- Documents why public_business_listings and public_directory_cities are
-- SECURITY DEFINER-style views (Postgres's default when security_invoker
-- isn't set) rather than flipping that off. Supabase's security linter flags
-- both CRITICAL — correct to flag in general, wrong for these two in
-- particular, and easy to "fix" by reflex into an outage.
--
-- Verified before writing this: public.businesses has exactly two RLS
-- policies, both `authenticated` + `is_admin()` — one SELECT, one UPDATE.
-- There is no policy granting anon, or any non-admin authenticated user,
-- any read access to businesses at all. These two views are the only path
-- by which a site visitor ever sees a business.
--
-- A DEFINER-style view runs its query as the view's owner, not the querying
-- role -- that's what lets it hand a filtered slice of businesses to anon
-- despite anon having zero direct grant on the table. Setting
-- `security_invoker = true` would make the view enforce the *caller's* RLS
-- instead of its owner's -- and since anon's RLS on businesses is "nothing",
-- the entire public directory would return zero rows for every visitor.
--
-- That means the view's own WHERE clause (is_published = true AND
-- archived_at IS NULL, see 20260801240000) is not a convenience filter on
-- top of RLS -- for anon, it IS the entire access control. There is no RLS
-- backstop behind it. If that clause is ever loosened or dropped without an
-- equivalent anon-readable RLS policy added to businesses first, unpublished
-- or archived rows become publicly visible with nothing to catch it.
--
-- Rollback: COMMENT ON VIEW public.public_business_listings IS NULL;
--           COMMENT ON VIEW public.public_directory_cities IS NULL;
-- ============================================================================

COMMENT ON VIEW public.public_business_listings IS
  'Intentionally SECURITY DEFINER: businesses has no RLS SELECT policy for '
  'anon/non-admin, so this view''s own WHERE clause (is_published AND NOT '
  'archived) is the sole access control for public reads, not a filter on '
  'top of RLS. Do not set security_invoker=true without first adding an '
  'equivalent anon-readable RLS policy on businesses -- flipping it today '
  'returns zero rows to every site visitor. See 20260801290000.';

COMMENT ON VIEW public.public_directory_cities IS
  'Intentionally SECURITY DEFINER: businesses has no RLS SELECT policy for '
  'anon/non-admin, so this view''s own WHERE clause (is_published AND NOT '
  'archived) is the sole access control for public reads, not a filter on '
  'top of RLS. Do not set security_invoker=true without first adding an '
  'equivalent anon-readable RLS policy on businesses -- flipping it today '
  'returns zero rows to every site visitor. See 20260801290000.';
