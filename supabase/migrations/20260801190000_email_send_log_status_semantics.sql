-- ============================================================================
-- Document what email_send_log.status actually means.
--
-- Discovered during end-to-end verification on 2026-08-01: a live test send to
-- dgarcia89@gmail.com logged status='sent', even though homequotelink.com is
-- under an outgoing-mail suspension at Byethost and the message was discarded.
--
-- The SMTP server ACCEPTS the message (auth succeeds, no error is returned),
-- and the discard happens downstream. The bounce arrives asynchronously, as a
-- separate inbound email, which nothing in this project currently ingests.
--
-- So: 'sent' means "the mail server accepted the handoff without raising an
-- error". It does NOT mean the message reached the recipient. Any UI built on
-- this column must not label it "delivered".
--
-- Closing that gap would require ingesting bounce notifications (the existing
-- receive-inbound-email function is the natural place) and adding a
-- 'bounced' status. Out of scope for this phase; tracked as follow-up work.
--
-- Rollback: COMMENT ON COLUMN public.email_send_log.status IS NULL;
-- ============================================================================

COMMENT ON COLUMN public.email_send_log.status IS
  'sent = the mail server accepted the handoff without error. NOT a delivery confirmation: a message can be accepted and then silently discarded (e.g. an outgoing-mail suspension), with the bounce arriving later as a separate inbound email that this project does not yet ingest. Do not label this "delivered" in any UI. failed = the send attempt itself errored.';
