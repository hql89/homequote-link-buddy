-- Allow a reply to be classified as "please take my listing down".
--
-- The outreach copy now explicitly invites this ("If you'd rather not be
-- listed, reply and I'll take it down"). Until now such a reply matched no
-- rule and landed as `unclassified` — the bucket nobody reads. A promise the
-- email makes and the system silently drops is worse than not offering it.
--
-- Distinct from `unsubscribe` because the two need different things done:
-- suppressing mail is automatic, unpublishing a listing is a content decision
-- and stays human. receive-inbound-email suppresses on both, so nothing that
-- would have been stopped before is stopped less now.

alter table public.inbound_emails
  drop constraint if exists inbound_emails_classification_check;

alter table public.inbound_emails
  add constraint inbound_emails_classification_check
  check (classification = any (array[
    'unsubscribe'::text,
    'removal_request'::text,
    'confirm'::text,
    'website'::text,
    'unclassified'::text,
    'bounce'::text,
    'self_sent'::text,
    'ignored'::text
  ]));

-- Rollback: restore the previous array (without 'removal_request'). Any rows
-- already carrying it must be reclassified first or the constraint will not
-- validate.
