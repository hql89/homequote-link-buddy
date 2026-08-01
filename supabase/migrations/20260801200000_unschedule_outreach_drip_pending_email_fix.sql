-- ============================================================================
-- Unschedules send-outreach-drip-daily (enabled earlier today in
-- 20260801160000) until outbound email delivery is actually working again.
--
-- WHY THIS IS URGENT RATHER THAN TIDY:
--
-- homequotelink.com is under an outgoing mail suspension at Byethost.
-- Verified 2026-08-01 17:01 UTC — the SMTP server ACCEPTS the message and
-- returns no error, then discards it. A test on 2026-07-26 21:52 UTC was
-- delivered normally, so this began somewhere in that window.
--
-- send-outreach-drip treats "SMTP accepted it" as success:
--
--     if (result.success) {
--       await supabase.from("businesses")
--         .update({ outreach_email_1_sent_at: new Date().toISOString() })
--
-- and selects candidates with `.is("outreach_email_1_sent_at", null)`.
--
-- So a run during the suspension would stamp every business as contacted
-- while delivering nothing, and those rows would never be picked up again.
-- That is silent, permanent, and unattributable after the fact — there would
-- be no way to tell which businesses were falsely marked.
--
-- Nothing qualifies today (all 23 businesses holding an email address have
-- outreach_paused = true), so this is pre-emptive. One un-paused business, or
-- one address found by enrich-business-email for an active row, is enough to
-- trigger it.
--
-- TO RE-ENABLE once mail delivery is confirmed: Admin -> Settings ->
-- Background Jobs -> "Send outreach emails", or re-run 20260801160000.
-- Before doing so, consider making the sent-stamp conditional on genuine
-- delivery rather than SMTP acceptance (see the bounce-ingestion follow-up in
-- docs/plans/implementation_plan_archive_and_audit_2026-08-01.md).
--
-- Rollback: re-run 20260801160000_schedule_send_outreach_drip.sql.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-outreach-drip-daily') THEN
    PERFORM cron.unschedule('send-outreach-drip-daily');
  END IF;
END;
$$;
