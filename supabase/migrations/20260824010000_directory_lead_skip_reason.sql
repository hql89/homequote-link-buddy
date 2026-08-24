-- Distinguishes "we deliberately didn't try to email this business" from a
-- genuine send failure (notify_error). Read by submit-directory-lead (write)
-- and the admin Overview dashboard (read, for the skipped-notifications count).
alter table public.directory_leads
  add column if not exists notify_skipped_reason text;

comment on column public.directory_leads.notify_skipped_reason is
  'Set when the business notification email was deliberately not sent '
  '(e.g. business.email_undeliverable_at or outreach_suppressed_at was set '
  'at submit time). Null means either it was sent, or it failed and '
  'notify_error explains why -- never both columns at once.';
