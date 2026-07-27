-- Let an admin publish a listing from the browser.
--
-- Publishing has never worked from the admin UI — not in bulk, and not the
-- per-row button either. Two independent layers were denying it:
--
--   1. `authenticated` held only SELECT on public.businesses, so PostgREST
--      failed at the GRANT level with "permission denied for table
--      businesses" before RLS was ever consulted.
--   2. RLS is enabled and the sole policy covered SELECT. With no UPDATE
--      policy, the default deny applied.
--
-- Both are fixed below, and both stay necessary: the GRANT alone would let
-- any signed-in user write, and the policy alone leaves the GRANT error.
--
-- Scoped to the `is_published` column on purpose. It is the only column the
-- app writes to this table (see setBusinessPublished / setBusinessesPublished
-- in src/integrations/supabase/directory.ts), and a column-level grant means a
-- stolen admin session still cannot rewrite a phone number, licence number or
-- business name — the fields that make a listing trustworthy. Widen this only
-- alongside a UI that actually needs it.

-- ── Layer 1: table privilege ────────────────────────────────────────────────
GRANT UPDATE (is_published) ON public.businesses TO authenticated;

-- ── Layer 2: row-level policy ───────────────────────────────────────────────
-- USING picks the rows an admin may target; WITH CHECK constrains the row
-- after the write. Both call is_admin(), which is SECURITY DEFINER with a
-- pinned search_path and resolves auth.uid() against admin_users.
DROP POLICY IF EXISTS "Admins can publish businesses" ON public.businesses;

CREATE POLICY "Admins can publish businesses"
  ON public.businesses
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── Rollback ────────────────────────────────────────────────────────────────
-- Restores the previous state exactly; publishing reverts to being impossible
-- from the browser and remains available to the service role.
--
--   DROP POLICY IF EXISTS "Admins can publish businesses" ON public.businesses;
--   REVOKE UPDATE (is_published) ON public.businesses FROM authenticated;
