-- ============================================================================
-- Separate "the mail server accepted it" from "it was delivered".
--
-- THE BUG: send-outreach-drip stamps outreach_email_1_sent_at whenever SMTP
-- returns without error, and selects candidates on that column being NULL.
-- Under the current Byethost suspension the server ACCEPTS every message and
-- discards it — so a run would permanently mark businesses as contacted,
-- having delivered nothing, and never retry them. Silent, irreversible, and
-- impossible to attribute afterwards.
--
-- Three changes:
--
--  1. email_send_log gains a 'bounced' status plus bounced_at/bounce_kind, so
--     a delivery failure that arrives later can be recorded against the
--     original send.
--
--  2. businesses gains outreach_bounced_at / outreach_bounce_kind /
--     email_undeliverable_at. A SENDER-side bounce (our domain blocked) clears
--     the sent stamp so the business is retried once sending works. A
--     RECIPIENT-side bounce (no such mailbox) does NOT — the send genuinely
--     happened, the address is simply dead, and retrying forever is wrong.
--
--  3. admin_settings gains outreach_delivery_verified_at, set by a human who
--     has confirmed a real test email arrived. The drip refuses to run when it
--     is missing or stale. This is the only guard that works TODAY: bounce
--     ingestion depends on the n8n IMAP bridge, which is not currently running
--     (inbound_emails is empty), so without it there is no delivery feedback
--     of any kind.
--
-- Rollback:
--   ALTER TABLE email_send_log DROP COLUMN bounced_at, DROP COLUMN bounce_kind;
--   ALTER TABLE businesses DROP COLUMN outreach_bounced_at,
--     DROP COLUMN outreach_bounce_kind, DROP COLUMN email_undeliverable_at;
--   (and restore the original status CHECK constraint)
-- ============================================================================

-- ── 1. email_send_log ──────────────────────────────────────────────────────
ALTER TABLE public.email_send_log
  DROP CONSTRAINT IF EXISTS email_send_log_status_check;

ALTER TABLE public.email_send_log
  ADD CONSTRAINT email_send_log_status_check
  CHECK (status IN ('sent', 'failed', 'bounced'));

ALTER TABLE public.email_send_log
  ADD COLUMN IF NOT EXISTS bounced_at  timestamptz,
  ADD COLUMN IF NOT EXISTS bounce_kind text;

COMMENT ON COLUMN public.email_send_log.status IS
  'sent = the mail server accepted the handoff without error — NOT a delivery confirmation. bounced = a delivery failure was later received for it. failed = the send attempt itself errored. Do not label "sent" as "delivered" in any UI.';

COMMENT ON COLUMN public.email_send_log.bounce_kind IS
  'sender_blocked = our domain could not send (suspension, block) — retryable once fixed. recipient_invalid = the address does not exist — not retryable. unknown = a bounce we could not classify.';

CREATE INDEX IF NOT EXISTS email_send_log_bounced_idx
  ON public.email_send_log (bounced_at DESC)
  WHERE bounced_at IS NOT NULL;

-- ── 2. businesses ──────────────────────────────────────────────────────────
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS outreach_bounced_at    timestamptz,
  ADD COLUMN IF NOT EXISTS outreach_bounce_kind   text,
  ADD COLUMN IF NOT EXISTS email_undeliverable_at timestamptz;

COMMENT ON COLUMN public.businesses.email_undeliverable_at IS
  'Set when a recipient-side bounce proved the address is dead. The outreach drip skips these — retrying a non-existent mailbox damages sender reputation.';

-- businesses has no table-level UPDATE grant; new columns need explicit
-- column-level grants or admin writes fail with "permission denied".
GRANT UPDATE (outreach_bounced_at, outreach_bounce_kind, email_undeliverable_at)
  ON public.businesses TO authenticated;

CREATE INDEX IF NOT EXISTS businesses_undeliverable_idx
  ON public.businesses (email_undeliverable_at)
  WHERE email_undeliverable_at IS NOT NULL;

-- ── 3. The delivery-verification gate ──────────────────────────────────────
-- Lazy default, matching how ingest_config and enrichment_config work: absent
-- means "never verified", which the drip treats as not safe to send.
COMMENT ON TABLE public.admin_settings IS
  'Key/value admin configuration. outreach_config.delivery_verified_at holds the last time a human confirmed a real outreach email actually arrived; send-outreach-drip refuses to run without a recent one.';
