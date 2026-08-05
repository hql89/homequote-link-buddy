-- ============================================================================
-- Allow 'self_sent' as an inbound_emails classification.
--
-- Ported from a sibling project (Mivos.ai) after a real incident there,
-- 2026-08: a notification was mailed FROM its own sending address TO that
-- same address (admin_notification_email had gone unset and its resolver
-- fell back to from_email), the inbound poller watching that mailbox picked
-- it up, an AI classifier read it as a new lead, and the resulting
-- notification fed the same loop again — indefinitely.
--
-- receive-inbound-email never sends mail itself (see its header comment), so
-- the exact loop cannot reproduce here today. But that is a property of the
-- current code, not something this table enforces, and Mivos's own postmortem
-- was explicit that the narrower "sender == recipient" check is not enough —
-- any other mailbox feeding the same ingest endpoint reproduces the loop with
-- one extra hop. This classification is the visible half of that defense:
-- reject by SENDER, regardless of recipient, logged distinctly rather than
-- silently dropped or misread as a bounce/reply.
--
-- Rollback: restore the five-value CHECK from 20260801280000. Any rows
-- already classified 'self_sent' would need reclassifying first.
-- ============================================================================

ALTER TABLE public.inbound_emails
  DROP CONSTRAINT IF EXISTS inbound_emails_classification_check;

ALTER TABLE public.inbound_emails
  ADD CONSTRAINT inbound_emails_classification_check
  CHECK (classification = ANY (ARRAY[
    'unsubscribe'::text,
    'confirm'::text,
    'website'::text,
    'unclassified'::text,
    'bounce'::text,
    'self_sent'::text
  ]));

COMMENT ON COLUMN public.inbound_emails.classification IS
  'self_sent = the message''s sender was one of this project''s own sending addresses. Rejected before bounce/reply classification and never acted on, to prevent an output-fed-back-into-input mail loop (see receive-inbound-email''s header comment and mailer.ts''s isSelfAddressed).';
