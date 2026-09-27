-- Undo bounce marks that were never really bounces.
--
-- receive-inbound-email updated EVERY 'sent' row for a bounced address, not
-- just the message that bounced. On 2026-09-27 one blocked alarm email to
-- dgarcia89@gmail.com marked six rows bounced at the same instant: itself,
-- four delivery probes from 23-26 Sept, and the test email the admin had
-- personally confirmed receiving four hours earlier.
--
-- Those five did arrive. Leaving them marked failed corrupts the only record
-- of what this domain actually delivers, and the bounce-rate circuit breaker
-- reads exactly these rows — one bounce could manufacture a streak and halt
-- outreach on evidence that never happened.
--
-- The code fix scopes the update to the single most recent send. This repairs
-- the rows it already damaged.
--
-- Narrow on purpose: only rows sharing a bounced_at timestamp with a LATER
-- send to the same address. A genuine bounce is always the newest outstanding
-- message to that recipient at the moment it arrives, so an older row marked
-- at the same instant can only be collateral.

update public.email_send_log victim
   set status = 'sent',
       bounced_at = null,
       bounce_kind = null
 where victim.status = 'bounced'
   and victim.bounced_at is not null
   and exists (
     select 1
       from public.email_send_log newer
      where newer.recipient_email = victim.recipient_email
        and newer.bounced_at = victim.bounced_at
        and newer.sent_at > victim.sent_at
   );

-- Rollback: none sensible — these rows are being restored to the truth. To
-- inspect what changed first, run the SELECT form of the same predicate.
