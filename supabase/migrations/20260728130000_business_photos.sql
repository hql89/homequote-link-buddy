-- Phase B of docs/plans/implementation_plan_business_imagery.md: contractor
-- photo uploads via the claim flow.
--
-- Design note that changes the RLS shape from what the plan originally
-- sketched: a claimed listing has no real login. claim-listing's own comment
-- says so explicitly — "no additional login system for business owners exists
-- yet" — and the owner's only credential, ever, is the claim_token emailed to
-- them. There is no auth.users row to hang RLS off. So every write to this
-- table goes through the manage-business-photos edge function, which
-- re-validates the token against businesses.claim_token on every call — the
-- same trust model claim-listing already uses — and writes with the service
-- role, which bypasses RLS entirely. That leaves this table needing only read
-- policies; no anon/authenticated insert, update, or delete policy exists on
-- purpose.

CREATE TABLE public.business_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  caption TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_business_photos_gallery ON public.business_photos(business_id, status, sort_order);

ALTER TABLE public.business_photos ENABLE ROW LEVEL SECURITY;

-- Public gallery read. Mirrors public_business_listings' is_published gate:
-- a photo is invisible to anon/authenticated until an admin approves it.
CREATE POLICY "Anyone can view approved photos"
  ON public.business_photos
  FOR SELECT
  TO anon, authenticated
  USING (status = 'approved');

-- Moderation queue needs to see pending and rejected too.
CREATE POLICY "Admins can view all photos"
  ON public.business_photos
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Scoped to `status` for the same reason the publish-permission fix scoped its
-- grant to is_published: an admin session should be able to moderate photos,
-- not rewrite which business a photo belongs to or forge its storage path.
CREATE POLICY "Admins can moderate photos"
  ON public.business_photos
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT ON public.business_photos TO anon, authenticated;
GRANT UPDATE (status) ON public.business_photos TO authenticated;

-- Storage. Public bucket, like blog-images — required so an approved photo
-- loads directly as <img src> without a signed URL. Worth being explicit
-- about what that means: the RLS above gates the *row* (whether a photo shows
-- up in a gallery or moderation query), but the object bytes themselves are
-- reachable by anyone holding the exact storage URL, moderated or not. That
-- URL is only ever returned to the uploader (via their claim_token) and to
-- admins — it is never rendered anywhere public before approval, so this is
-- "unlisted," the same posture Supabase Storage buckets have by default, not
-- a leak of pending photos to anyone browsing the site.
INSERT INTO storage.buckets (id, name, public)
VALUES ('business-photos', 'business-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Rollback:
--   DROP TABLE IF EXISTS public.business_photos;
--   DELETE FROM storage.objects WHERE bucket_id = 'business-photos';
--   DELETE FROM storage.buckets WHERE id = 'business-photos';
