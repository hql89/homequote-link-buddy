-- Record WHY an address was judged undeliverable, not just that it was.
--
-- `email_undeliverable_at` is set from two very different findings, and they
-- have different fixes:
--   • the recipient's server rejected the mailbox (a real bounce), vs
--   • the domain has no mail exchanger at all (found before sending, by the
--     pre-send DNS check added alongside this migration).
-- Collapsing both into one timestamp means the admin screens cannot tell an
-- operator which happened. Reusing `outreach_bounce_kind` for the second case
-- would be worse than unhelpful: it would record a bounce that never occurred,
-- and the bounce-rate circuit breaker reads bounce state.
--
-- Nullable, no default, so every existing row is untouched and "we never
-- recorded a reason" stays distinguishable from "there was no reason".

alter table public.businesses
  add column if not exists email_undeliverable_reason text;

comment on column public.businesses.email_undeliverable_reason is
  'Why the address was marked undeliverable — e.g. a bounce kind, or the DNS '
  'finding from the pre-send mail-domain check. Null for rows marked before '
  'this column existed.';

-- Reads are already covered: `authenticated` holds table-level SELECT on
-- businesses, which extends to new columns automatically.
--
-- Writes are NOT. Every sibling column an admin screen can edit
-- (email_undeliverable_at, outreach_bounce_kind, email_review_notes, ...)
-- carries its own column-level UPDATE grant, because `authenticated` has no
-- table-level UPDATE here. Omitting this is how new columns on this table have
-- shipped broken before: the write compiles, passes review, and dies at
-- runtime with "permission denied for table businesses". Granted so that
-- clearing an undeliverable flag can clear its reason in the same statement.
grant update (email_undeliverable_reason) on public.businesses to authenticated;

-- Rollback:
--   alter table public.businesses drop column if exists email_undeliverable_reason;
