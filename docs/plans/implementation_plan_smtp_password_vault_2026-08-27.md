# Implementation plan — move the SMTP password out of `admin_settings` into Supabase Vault

Date: 2026-08-27
Status: awaiting approval

## The problem

`admin_settings.setting_value` for `setting_key = 'smtp_config'` holds the live mail
account password in plaintext under the `smtpPassword` key. Confirmed present in the
live database today.

RLS on `admin_settings` is `is_admin()` for `authenticated`, so this is not
world-readable. It is still exposed to:

- every service-role caller (all edge functions bypass RLS, and seven of them read
  this row),
- any future bug that returns the whole settings row,
- the admin's own browser — `src/pages/admin/Settings.tsx:49` selects the entire
  `setting_value` and puts it in React state, and `SMTPSettings.tsx:273` binds it to
  an input with a reveal toggle. It is in devtools, in a screenshot, in a session
  replay.

## What reads and writes it today

Discovered by grep; note this is **more than the two files named in the task**.

Writers:
- `src/pages/admin/settings/SMTPSettings.tsx:135` (`handleSave`) and `:161`
  (`handleTest` saves before testing) — upsert the whole config blob including the password.
- `supabase/functions/_shared/emailSafety.ts:240-248` — circuit breaker read-modify-writes
  the row to set `enabled: false`. It merges rather than replaces, so it currently
  rewrites the password back. Must keep working after the key is gone.

Readers of the password specifically:
- `supabase/functions/_shared/mailer.ts:65` `loadSmtpConfig()` → used by
  `send-outreach-drip`, `email-canary`, `ingest-business`, `submit-directory-lead`,
  and `receive-inbound-email` (the last one only needs identity fields, not the password).
- `supabase/functions/notify-admin-email/index.ts:259-277` — a **second, independent
  inline reader** with its own duplicated config type and its own `SMTPClient` at `:413`.

Readers of non-secret fields only (unaffected):
- `src/pages/admin/Settings.tsx`, `src/pages/admin/Outreach.tsx:248`,
  `src/pages/admin/OutreachSent.tsx:171`, `supabase/functions/email-canary/index.ts:122`.

## Chosen approach: Vault, not an edge function secret

Both were on the table. Vault wins because the admin UI must stay able to rotate the
password without a CLI. An edge-function secret can only be set with
`supabase secrets set`, which makes rotation a developer task; the SMTP password is
an operational credential the site owner changes when the mail host forces it.

Vault also keeps one source of truth for all seven functions, and there is already a
working precedent in this repo for reading it from SQL
(`supabase/migrations/20260827020000_enrich_cron_vault_read_failsafe.sql`).

Secret name: `smtp_password`. `vault.secrets` is currently empty.

### Access path

The `vault` schema is owned by `supabase_admin` and grants nothing to `anon`,
`authenticated`, or `service_role`, so PostgREST cannot reach it directly. Two
`SECURITY DEFINER` functions in `public` are the only doors:

| Function | Caller | Gate |
|---|---|---|
| `public.get_smtp_password()` | edge functions, via service-role client | `EXECUTE` granted **only** to `service_role`; revoked from `PUBLIC`, `anon`, `authenticated` |
| `public.admin_set_smtp_password(p_password text)` | admin browser, via user JWT | `is_admin()` check inside; `EXECUTE` to `authenticated` |

`admin_set_smtp_password` is called with the caller's JWT, not a service-role client —
`is_admin()` reads `auth.uid()` and returns false under service role.

## Files changed

### New — `supabase/migrations/20260827230000_smtp_password_to_vault.sql`
Additive only. Does **not** remove the plaintext key yet.
1. Create `public.get_smtp_password()` and `public.admin_set_smtp_password(text)` with
   the grants above.
2. Seed the vault by **copying the value out of `admin_settings` at apply time** —
   `vault.create_secret((select setting_value->>'smtpPassword' from admin_settings …), 'smtp_password', …)`.
   No password literal ever appears in the migration file or in git.
3. A `DO` block asserts the value reads back through `get_smtp_password()` and matches
   what is still in the JSON. If postgres cannot read `vault.decrypted_secrets`, or the
   view shape differs, `supabase db push` **fails here** — before any reader has been
   changed and before anything can break.
4. Write `smtpPasswordHint` (masked tail) and `smtpPasswordUpdatedAt` into the config row.

### New — `supabase/migrations/20260827234500_smtp_password_drop_plaintext.sql`
Applied **only after** the canary confirms sending still works. Strips the
`smtpPassword` key from the JSON row. Kept as a separate file precisely so the cutover
is staged and reversible.

### `supabase/functions/_shared/mailer.ts`
`loadSmtpConfig()` fetches the row as today, then calls `get_smtp_password()` and
injects the result. During the window between migration 1 and migration 2 it falls
back to the JSON field with a `console.warn`, so there is no instant at which sending
is broken. After migration 2 the fallback is dead but stays as a safety net that
announces itself if it ever fires.

`SmtpConfig.smtpPassword` stays on the edge-function type — that side legitimately
needs the value.

### `supabase/functions/notify-admin-email/index.ts`
Same injection in its inline reader. This is the function the admin "Send Test Email"
button hits, so it must be correct or the UI's own verification path breaks.

### `src/pages/admin/Settings.tsx`
Strip `smtpPassword` before `setConfig`, so the value never enters React state.

### `src/pages/admin/settings/SMTPSettings.tsx`
Follow `PerplexitySettings.tsx`:
- `SmtpConfig` (frontend type) loses `smtpPassword`, gains `smtpPasswordHint?`.
- The bound password input becomes a write-only "replace password" field with its own
  local state, saved via the `admin_set_smtp_password` RPC. Masked hint
  (`••••••••abcd`) shown when one is stored, "No password configured" when not.
- The eye/reveal toggle is **removed** — there is nothing left to reveal.
- `handleSave` and `handleTest` no longer write a password into the blob.

### `tests/unit/SMTPSettings.test.tsx`
Add assertions mirroring `tests/unit/PerplexitySettings.test.tsx`: a stored password
never appears in `container.innerHTML`, the input stays empty and `type="password"`,
and the `admin_settings` upsert payload contains no `smtpPassword` key. Existing
test/confirm/canary assertions must keep passing.

### `tests/unit/emailSafety.test.ts`
Lines 178-202 assert the breaker preserves `smtpPassword` across its merge. That
assertion becomes wrong by design — retarget it to a non-secret field
(`smtpUsername`) so it still proves "merge, never replace".

## Test strategy

- `npx vitest run` for the unit suites above.
- Migration 1's built-in assertion is the real test of the vault access path.
- After deploying the functions: trigger `email-canary` and confirm a successful send,
  then check `email_send_log` for a `method: "smtp"` row. This is the instruction's
  "verify with the email canary" step and it gates migration 2.
- `supabase functions list` before/after, per the standing rule that deploy state is
  not in git.

## Migrations required

Two, in order, with a verification gate between them. Both under
`supabase/migrations/`, applied with `supabase db push --linked`.

## Rollback

- Migration 1: `DROP FUNCTION public.get_smtp_password(); DROP FUNCTION public.admin_set_smtp_password(text);`
  and delete the vault row. The plaintext key is still present at this stage, so
  sending is unaffected.
- Migration 2 (the only destructive step): restore with
  `UPDATE admin_settings SET setting_value = setting_value || jsonb_build_object('smtpPassword', public.get_smtp_password()) WHERE setting_key='smtp_config';`
  The value is still in the vault, so this is recoverable without knowing the password.
- Edge functions: redeploy the previous revision; the fallback path means the old code
  also works against a database that has had migration 1 but not migration 2.

## Timing

`send-outreach-drip-daily` runs at 15:00 UTC; it is 23:36 UTC now, so there is a
~15 hour window. `email-canary-check` runs 14:00 UTC, `enrich-business-email-daily`
13:00 UTC. No conflict.

## Acceptance criteria

1. `admin_settings.smtp_config` contains no `smtpPassword` key.
2. `vault.secrets` contains `smtp_password`.
3. `get_smtp_password()` is not executable by `anon` or `authenticated` — verified
   against `information_schema.role_routine_grants`.
4. The email canary sends successfully via SMTP after the change.
5. The admin Settings page can set a new password, and shows only a masked hint;
   the password is absent from rendered HTML and from React state.
6. The circuit breaker's merge-write still preserves the rest of the config.
7. No password literal in any committed file.
