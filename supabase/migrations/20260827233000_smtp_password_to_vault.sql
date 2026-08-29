-- ============================================================================
-- Move the SMTP password out of admin_settings plaintext and into Vault.
--
-- admin_settings.setting_value for setting_key='smtp_config' has always held
-- the live mail account password as readable text under `smtpPassword`. RLS
-- limits the row to is_admin(), so it was never world-readable, but that still
-- leaves it exposed to every service-role caller (seven edge functions read
-- this row), to any future bug that returns the whole settings blob, and — most
-- immediately — to the admin's own browser, since Settings.tsx selected the
-- entire setting_value into React state and bound the password to an input
-- with a reveal toggle.
--
-- This migration is deliberately ADDITIVE. It seeds the vault and adds the two
-- access functions but leaves `smtpPassword` in place, so mail keeps sending on
-- the existing readers. A separate later migration drops the plaintext key,
-- and only after the email canary has confirmed the new path works.
--
-- The password itself is never written into this file: the seed block below
-- copies it out of admin_settings at apply time.
--
-- Access path (verified against this project before writing):
--   - the `vault` schema is owned by supabase_admin and grants nothing to anon,
--     authenticated or service_role, so PostgREST cannot reach it directly;
--   - `postgres`, which owns these SECURITY DEFINER functions, holds
--     pg_read_all_data (so it can SELECT vault.secrets) and EXECUTE on
--     vault._crypto_aead_det_decrypt / create_secret / update_secret.
--   These two functions are therefore the only doors to the secret.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.get_smtp_password();
--   DROP FUNCTION IF EXISTS public.admin_set_smtp_password(text);
--   DELETE FROM vault.secrets WHERE name = 'smtp_password';
--   -- The plaintext key is still present at this stage, so sending is
--   -- unaffected by rolling this back.
-- ============================================================================

-- ── Reader: backend only ─────────────────────────────────────────────────────
-- Returns NULL rather than raising when the secret is absent. The caller
-- (mailer.ts / notify-admin-email) turns that into an explicit, honest failure
-- with a message naming the cause; a raise here would instead surface to the
-- edge function as an opaque PostgREST error.
CREATE OR REPLACE FUNCTION public.get_smtp_password()
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'smtp_password';

  RETURN v_secret;
END;
$fn$;

-- service_role ONLY. An admin's browser session must never be able to read the
-- password back — that is the whole point of moving it. The admin rotates it
-- through admin_set_smtp_password below, which is write-only by construction.
REVOKE ALL ON FUNCTION public.get_smtp_password() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_smtp_password() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_smtp_password() TO service_role;

COMMENT ON FUNCTION public.get_smtp_password() IS
  'Returns the SMTP password from Vault. service_role only — never grant to authenticated.';

-- ── Writer: admin browser only ───────────────────────────────────────────────
-- Called with the admin's own JWT, not a service-role client: is_admin() reads
-- auth.uid() and returns false under service role.
CREATE OR REPLACE FUNCTION public.admin_set_smtp_password(p_password text)
RETURNS text
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_id uuid;
  v_clean text := btrim(coalesce(p_password, ''));
  v_hint text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF v_clean = '' THEN
    RAISE EXCEPTION 'SMTP password cannot be empty';
  END IF;

  SELECT id INTO v_id FROM vault.secrets WHERE name = 'smtp_password';

  IF v_id IS NULL THEN
    PERFORM vault.create_secret(
      v_clean,
      'smtp_password',
      'SMTP password for the project mail account.'
    );
  ELSE
    PERFORM vault.update_secret(v_id, v_clean);
  END IF;

  v_hint := '••••••••' || right(v_clean, 4);

  -- Also strips any plaintext `smtpPassword` still present, so an admin saving
  -- a new password cleans up the old exposure even if this runs before the
  -- drop-plaintext migration.
  UPDATE public.admin_settings
  SET setting_value = (setting_value - 'smtpPassword')
        || jsonb_build_object(
             'smtpPasswordHint', v_hint,
             'smtpPasswordUpdatedAt', now()
           )
  WHERE setting_key = 'smtp_config';

  -- The masked hint, so the UI can show which password is stored without ever
  -- receiving the password. Never returns v_clean.
  RETURN v_hint;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_set_smtp_password(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_smtp_password(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_smtp_password(text) TO authenticated;

COMMENT ON FUNCTION public.admin_set_smtp_password(text) IS
  'Stores the SMTP password in Vault and returns only a masked hint. Admin JWT required.';

-- ── Seed from the existing plaintext, and prove the read path works ──────────
-- No password literal appears here: the value is copied out of admin_settings
-- at apply time. Error messages below are deliberately written so that none of
-- them can interpolate the password into a log.
DO $seed$
DECLARE
  v_plain text;
  v_readback text;
BEGIN
  SELECT setting_value->>'smtpPassword' INTO v_plain
  FROM public.admin_settings
  WHERE setting_key = 'smtp_config';

  IF v_plain IS NULL OR btrim(v_plain) = '' THEN
    RAISE EXCEPTION
      'No smtpPassword found in admin_settings.smtp_config — nothing to migrate. '
      'Refusing to continue rather than leave the mailer with no credential.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'smtp_password') THEN
    PERFORM vault.create_secret(
      btrim(v_plain),
      'smtp_password',
      'SMTP password for the project mail account. Moved out of admin_settings plaintext 2026-08-27.'
    );
  END IF;

  -- The real test of the access path. If postgres cannot read
  -- vault.decrypted_secrets, or the view shape differs from what
  -- get_smtp_password() expects, `supabase db push` fails HERE — before any
  -- reader has been changed and before mail can break.
  SELECT public.get_smtp_password() INTO v_readback;

  IF v_readback IS DISTINCT FROM btrim(v_plain) THEN
    RAISE EXCEPTION
      'Vault read-back mismatch: get_smtp_password() did not return the stored '
      'password. Aborting before any reader is changed.';
  END IF;

  UPDATE public.admin_settings
  SET setting_value = setting_value
        || jsonb_build_object(
             'smtpPasswordHint', '••••••••' || right(btrim(v_plain), 4),
             'smtpPasswordUpdatedAt', now()
           )
  WHERE setting_key = 'smtp_config';
END;
$seed$;
