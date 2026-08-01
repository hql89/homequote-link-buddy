-- ============================================================================
-- email_send_log — append-only record of every outbound email attempt.
--
-- Why this exists: on 2026-07-25 four "new quote request" emails were sent to
-- real businesses. job_run_logs recorded business_id and lead_id; both rows
-- were later hard-deleted, so the question "which addresses did we email?"
-- became permanently unanswerable.
--
-- The fix is that `recipient_email` stores the literal address AT SEND TIME.
-- It is not derived, not joined, and cannot dangle.
--
-- related_business_id / related_lead_id deliberately carry NO FOREIGN KEY.
-- A real FK would either block deletion of the referenced row or cascade and
-- destroy this log — both defeat the purpose. A dangling uuid here is
-- acceptable precisely because recipient_email already answers the question.
--
-- Retention: indefinite. Purged only by a deliberate, size-driven admin action
-- (see docs/plans/implementation_plan_archive_and_audit_2026-08-01.md §7).
-- Never on a timer.
--
-- Rollback: DROP TABLE public.email_send_log;
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.email_send_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sent_at             timestamptz NOT NULL DEFAULT now(),

  -- Which code path sent it, e.g. 'send-outreach-drip', 'notify-admin-email'.
  job_name            text NOT NULL,
  -- Semantic kind, e.g. 'outreach_verify', 'quote_request', 'test'.
  email_type          text NOT NULL,

  -- The literal address. The whole point of this table.
  recipient_email     text NOT NULL,
  -- 'business' | 'lead' | 'admin' | 'buyer' — intentionally unconstrained so a
  -- new sender never fails to log just because it introduced a new kind.
  recipient_kind      text,

  subject             text,

  -- Soft references. NO FK BY DESIGN — see header.
  related_business_id uuid,
  related_lead_id     uuid,

  status              text NOT NULL CHECK (status IN ('sent', 'failed')),
  method              text,          -- 'smtp' | 'resend' | 'none'
  error_message       text
);

COMMENT ON TABLE public.email_send_log IS
  'Append-only log of outbound email attempts. recipient_email is captured at send time as literal text; related_* columns are soft references with no FK so deleting a business never destroys the record of having emailed it.';

COMMENT ON COLUMN public.email_send_log.related_business_id IS
  'Soft reference — intentionally has no foreign key constraint. May point at a deleted row.';

-- Recent-first listing.
CREATE INDEX IF NOT EXISTS email_send_log_sent_at_idx
  ON public.email_send_log (sent_at DESC);

-- "Have we ever emailed this address?" — the forensic query.
CREATE INDEX IF NOT EXISTS email_send_log_recipient_idx
  ON public.email_send_log (lower(recipient_email));

-- "What did we send this business?" — survives the business being deleted.
CREATE INDEX IF NOT EXISTS email_send_log_business_idx
  ON public.email_send_log (related_business_id)
  WHERE related_business_id IS NOT NULL;

-- Surfacing failures.
CREATE INDEX IF NOT EXISTS email_send_log_status_idx
  ON public.email_send_log (status, sent_at DESC)
  WHERE status = 'failed';

ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;

-- Admins read. Edge functions write under the service role, which bypasses RLS,
-- so no INSERT policy is granted to anyone — nothing outside a service-role
-- context can write here, and nothing but an admin can read it.
DROP POLICY IF EXISTS "Admins can read email send log" ON public.email_send_log;
CREATE POLICY "Admins can read email send log"
  ON public.email_send_log
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

GRANT SELECT ON public.email_send_log TO authenticated;
