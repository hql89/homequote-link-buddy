-- ============================================================================
-- Drop the plaintext SMTP password from admin_settings.
--
-- The closing step of the move begun in 20260827233000. That migration seeded
-- Vault and proved the read path; the readers (_shared/mailer.ts via
-- _shared/smtpSecret.ts, and notify-admin-email's own duplicate reader) have
-- since been deployed and confirmed to resolve the password without touching
-- this key. Removing it is what actually closes the exposure — everything
-- before this point only added the safe path alongside the unsafe one.
--
-- Guarded rather than unconditional: it refuses to delete the only copy of the
-- password if, for any reason, Vault cannot produce it. A DELETE that runs when
-- the vault is empty would destroy the live mail credential outright.
--
-- Rollback (the value is still in Vault, so this needs no knowledge of it):
--   UPDATE public.admin_settings
--   SET setting_value = setting_value
--         || jsonb_build_object('smtpPassword', public.get_smtp_password())
--   WHERE setting_key = 'smtp_config';
-- ============================================================================

DO $drop$
DECLARE
  v_vault text;
BEGIN
  SELECT public.get_smtp_password() INTO v_vault;

  IF v_vault IS NULL OR btrim(v_vault) = '' THEN
    RAISE EXCEPTION
      'Refusing to drop the plaintext SMTP password: Vault has no readable '
      '"smtp_password" secret, so this row is the only copy. Re-run '
      '20260827233000 (or set the password in Admin -> Settings) first.';
  END IF;

  UPDATE public.admin_settings
  SET setting_value = setting_value - 'smtpPassword'
  WHERE setting_key = 'smtp_config';
END;
$drop$;

-- Belt and braces: prove the key is actually gone, so a silent no-op (wrong
-- setting_key, row missing) cannot pass for success.
DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.admin_settings
    WHERE setting_key = 'smtp_config'
      AND setting_value ? 'smtpPassword'
  ) THEN
    RAISE EXCEPTION 'smtpPassword is still present in admin_settings.smtp_config after the drop.';
  END IF;
END;
$verify$;
