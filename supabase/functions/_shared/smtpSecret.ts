/**
 * Resolves the SMTP password from Supabase Vault.
 *
 * The password used to live in `admin_settings.smtp_config.smtpPassword` as
 * readable text. It now lives in Vault under the secret name `smtp_password`,
 * reachable only through the `get_smtp_password()` RPC, which is executable by
 * `service_role` alone — an admin's browser session cannot read it back.
 *
 * Deliberately has no runtime import of its own, so it can be unit-tested
 * against a fake client. Same split rationale as emailSafety.ts: mailer.ts
 * cannot be tested directly because SMTPClient there is a real network import.
 *
 * Nothing in this module ever logs the password. The fallback warning below
 * reports only that the fallback fired and why, never the value.
 */

export interface SmtpPasswordResult {
  password: string | null;
  error: string | null;
  /**
   * True when the value came from the legacy plaintext field rather than
   * Vault. Surfaced so callers can record a degraded read rather than treating
   * it as an ordinary success.
   */
  legacy: boolean;
}

/** Structural shape of the one client method used, so tests need no real client. */
export interface RpcCaller {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
}

export async function loadSmtpPassword(
  supabase: RpcCaller,
  /**
   * The legacy `smtpPassword` field, if the settings row still carries one.
   * This exists only to keep mail flowing across the migration window — the
   * Vault seed and the plaintext drop are separate migrations, and between
   * them either source is valid. After the drop it is always undefined.
   */
  legacyPlaintext?: string | null,
): Promise<SmtpPasswordResult> {
  const { data, error } = await supabase.rpc("get_smtp_password");

  if (!error && typeof data === "string" && data.trim() !== "") {
    return { password: data, error: null, legacy: false };
  }

  const fallback = (legacyPlaintext ?? "").trim();
  if (fallback !== "") {
    console.warn(
      "[smtpSecret] Using the legacy plaintext SMTP password from admin_settings — " +
        (error
          ? `the Vault read failed: ${error.message}.`
          : "Vault holds no secret named 'smtp_password'.") +
        " This path is meant to be dead. Seeing it means the Vault migration was rolled back, " +
        "the secret was deleted, or the RPC grant to service_role was lost.",
    );
    return { password: fallback, error: null, legacy: true };
  }

  // Honest failure: say which of the two distinguishable causes it was rather
  // than reporting a generic "SMTP not configured", which would send whoever
  // reads it to the Settings page for a problem that is not there.
  return {
    password: null,
    error: error
      ? `Could not read the SMTP password from Vault: ${error.message}`
      : "No SMTP password is stored. Set one in Admin → Settings → Email Notifications.",
    legacy: false,
  };
}
