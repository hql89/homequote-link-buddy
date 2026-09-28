-- Correct the one address that carried a percent-encoded space.
--
-- Lush Gardens Inc was stored as '%20info@lushgardensinc.com', verified,
-- emailed 2026-09-27 15:00 and bounced 15:03. The %20 came from a space the
-- page author left inside their own mailto: link; the extractor took it as
-- part of the local part. Fixed at source in the same change as this.
--
-- The repair is strictly a decode of what was already there — '%20' removed,
-- nothing else invented. The domain was independently verified when the row
-- was enriched, so this is reading the stored value correctly rather than
-- guessing at a plausible address.
--
-- The bounce flags are cleared because the bounce was ours, not theirs: the
-- address never existed to bounce. Left set, `email_undeliverable_at` would
-- also gate their quote-request notifications, silencing a real business's
-- leads over our own formatting bug. `outreach_email_1_sent_at` is cleared
-- too, so they receive the Email 1 they were never actually sent.
--
-- Deliberately matches the one known pattern rather than anything containing
-- '%': a blanket rewrite could mangle an address where '%' is genuinely part
-- of the local part, which the RFC permits.

update public.businesses
   set email = regexp_replace(email, '^%20', ''),
       email_undeliverable_at = null,
       email_undeliverable_reason = null,
       outreach_bounced_at = null,
       outreach_bounce_kind = null,
       outreach_email_1_sent_at = null
 where email like '\%20%@%'
   and regexp_replace(email, '^%20', '') ~ '^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$';

-- The send log keeps its bounced row: that send genuinely did bounce, and
-- rewriting history there would hide the incident this migration exists for.

-- Rollback:
--   update public.businesses set email = '%20' || email
--    where email = 'info@lushgardensinc.com';
