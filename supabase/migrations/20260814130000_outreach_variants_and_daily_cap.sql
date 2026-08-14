-- ============================================================================
-- Outreach: editable copy, A/B variants, and a real daily send cap.
--
-- Two problems this fixes, both flagged before turning outreach on:
--
-- 1. The send cap was `BATCH_LIMIT = 50`, a hardcoded constant applied PER
--    INVOCATION. Two runs in one day sent 100. There was no admin-facing
--    number at all, so "set it to 10" was not a thing anyone could do.
--    `outreach_sends` exists so the cap can be counted per calendar day
--    across every run — neither businesses.outreach_email_{1,2}_sent_at nor
--    email_send_log can answer that: the former records only the latest send
--    per business per stage, the latter mixes in every other email the
--    system sends (nurture, quote notifications, canary probes).
--
-- 2. Outreach copy lived in DEFAULT_OUTREACH_TEMPLATES in
--    _shared/directory.ts. loadOutreachTemplates() has always been able to
--    read an admin override, but no UI was ever built to write one, and
--    there was no way to run more than one version at a time.
--
-- Seeded so this ships as a behavioural no-op: variant 'A' for each stage is
-- byte-for-byte the copy those constants produce today. Nothing sends
-- differently until someone edits a variant or adds a second one.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.outreach_sends;
--   DROP TABLE IF EXISTS public.outreach_template_variants;
--   DROP FUNCTION IF EXISTS public.admin_outreach_variant_stats();
--   UPDATE admin_settings SET setting_value = setting_value - 'daily_limit'
--     WHERE setting_key = 'outreach_config';
-- ============================================================================

-- ── Variants ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.outreach_template_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Same vocabulary as email_send_log.email_type and the
  -- DEFAULT_OUTREACH_TEMPLATES keys. Deliberately not a third set of names
  -- ('verify'/'preview') for the same two things.
  email_type text NOT NULL CHECK (email_type IN ('outreach_verify', 'outreach_preview')),
  variant_key text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  weight integer NOT NULL DEFAULT 1 CHECK (weight >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email_type, variant_key)
);

-- ── Send log ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.outreach_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ON DELETE CASCADE: a deleted business's send history has no independent
  -- meaning, and keeping orphans would inflate the daily count against a
  -- business that no longer exists.
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  email_type text NOT NULL CHECK (email_type IN ('outreach_verify', 'outreach_preview')),
  variant_key text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

-- The daily-cap query is `WHERE sent_at >= <start of today>` on every run;
-- the stats RPC groups by (email_type, variant_key).
CREATE INDEX IF NOT EXISTS outreach_sends_sent_at_idx
  ON public.outreach_sends (sent_at DESC);
CREATE INDEX IF NOT EXISTS outreach_sends_variant_idx
  ON public.outreach_sends (email_type, variant_key);
CREATE INDEX IF NOT EXISTS outreach_sends_business_idx
  ON public.outreach_sends (business_id);

-- ── RLS: admin-read, service-role-write ─────────────────────────────────────
-- Same posture as job_run_logs. The edge function writes with the service
-- role, which bypasses RLS, so no INSERT policy is needed — and omitting one
-- is what stops a browser client from forging send history (which would let
-- it silently consume the daily budget) or rewriting outreach copy.

ALTER TABLE public.outreach_template_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read outreach variants"
  ON public.outreach_template_variants FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- The variant editor is an admin-only page, so unlike the send log this one
-- does need client writes. Column-level GRANTs below are the other half of
-- this — a policy alone would still fail with "permission denied".
CREATE POLICY "Admins can write outreach variants"
  ON public.outreach_template_variants FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update outreach variants"
  ON public.outreach_template_variants FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete outreach variants"
  ON public.outreach_template_variants FOR DELETE
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can read outreach sends"
  ON public.outreach_sends FOR SELECT
  TO authenticated
  USING (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.outreach_template_variants TO authenticated;
GRANT SELECT ON public.outreach_sends TO authenticated;

-- ── Seed: today's live copy, verbatim, as variant 'A' ───────────────────────
-- These two strings must match what DEFAULT_OUTREACH_TEMPLATES renders. If
-- they drift, the seed is wrong, not the constant — the constant stays as
-- the last-resort fallback for a stage with no active variant.

INSERT INTO public.outreach_template_variants (email_type, variant_key, subject, body, weight, is_active)
VALUES (
  'outreach_verify',
  'A',
  'Quick question about {{business_name}} in {{city}}',
  E'Hi {{owner_name}},\n\nI built a local directory for {{city}} businesses and added {{business_name}}. I want to make sure your phone number ({{phone}}) is correct before we push it live.\n\nIf it is correct, please reply YES. If not, let me know what to change.\n\nBest,\n{{sender_name}}',
  1,
  true
)
ON CONFLICT (email_type, variant_key) DO NOTHING;

INSERT INTO public.outreach_template_variants (email_type, variant_key, subject, body, weight, is_active)
VALUES (
  'outreach_preview',
  'A',
  'Your {{city}} listing is ready for preview',
  E'Hi {{owner_name}},\n\nHere is the live listing we set up for you:\n{{claim_url}}\n\nIt''s free to claim, and here''s exactly what that means: once you do, homeowners can request quotes straight from the page. Every request goes only to you — we never sell or share it, and there''s no fee or commission. Your own phone number is on the page too, so calls go directly to you, not through us.\n\nClaiming takes under a minute — just confirm your email and phone.\n\nBest,\n{{sender_name}}',
  1,
  true
)
ON CONFLICT (email_type, variant_key) DO NOTHING;

-- ── Daily limit ─────────────────────────────────────────────────────────────
-- Merged into the existing outreach_config row (which already holds
-- delivery_verified_at, written by SMTPSettings.tsx) rather than replacing
-- it. Default 10, deliberately low: the first real send should be small.
-- There is no `enabled` flag here — the send-outreach-drip-daily cron toggle
-- on Admin -> Settings -> Background Jobs already is that switch, and a
-- second one controlling the same job would be ambiguous.

INSERT INTO public.admin_settings (setting_key, setting_value)
VALUES ('outreach_config', '{"daily_limit": 10}'::jsonb)
ON CONFLICT (setting_key) DO UPDATE
  SET setting_value = public.admin_settings.setting_value || '{"daily_limit": 10}'::jsonb
  WHERE NOT (public.admin_settings.setting_value ? 'daily_limit');

-- ── Per-variant results ─────────────────────────────────────────────────────
-- SECURITY DEFINER + explicit is_admin() check, same shape as
-- admin_recent_job_runs. Reading this joins businesses and inbound_emails,
-- so it must not be reachable by anon.
--
-- "Replied" counts a business that sent ANY inbound email after the outreach
-- went out — including an unsubscribe. That is deliberate: for Email 1,
-- whose entire ask is "reply YES", a reply is the response being measured,
-- and treating a STOP as a non-response would flatter a variant that
-- provokes them. The claim rate below is the outcome metric.

CREATE OR REPLACE FUNCTION public.admin_outreach_variant_stats()
RETURNS TABLE (
  email_type text,
  variant_key text,
  sent_count bigint,
  replied_count bigint,
  claimed_count bigint,
  last_sent_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT
    s.email_type,
    s.variant_key,
    count(*)::bigint AS sent_count,
    count(*) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM public.inbound_emails ie
        WHERE ie.business_id = s.business_id
          AND ie.received_at >= s.sent_at
      )
    )::bigint AS replied_count,
    count(*) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM public.businesses b
        WHERE b.id = s.business_id
          AND b.is_claimed = true
          AND b.claimed_at >= s.sent_at
      )
    )::bigint AS claimed_count,
    max(s.sent_at) AS last_sent_at
  FROM public.outreach_sends s
  GROUP BY s.email_type, s.variant_key
  ORDER BY s.email_type, s.variant_key;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_outreach_variant_stats() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_outreach_variant_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_outreach_variant_stats() TO authenticated;
