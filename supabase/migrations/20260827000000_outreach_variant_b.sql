-- A second variant for each outreach email, so the A/B machinery finally has
-- something to compare.
--
-- `outreach_template_variants` has held exactly one row per email type since it
-- was created, both variant_key = 'A'. pickVariant() has therefore been
-- choosing between a set of one on every send, and all 27 emails to date went
-- out as A. The 15% unsubscribe rate has no control to read it against.
--
-- Hypothesis under test. A opens with what we built and asks the contractor to
-- do administrative work for us ("confirm your phone number", "claim your
-- listing") without first saying what they get. B opens with the reason a
-- contractor would care — homeowners in their own city finding them directly,
-- no lead broker in between — makes the ask smaller, and offers an explicit
-- "take it down" out. If the opt-out rate is driven by "why am I being asked
-- to do a chore for a stranger", B should move it.
--
-- INSERTED INACTIVE ON PURPOSE. This copy goes to real local business owners.
-- is_active = false is honoured in two places (the .eq("is_active", true) in
-- pickOutreachVariant and the filter inside pickVariant), so these rows cannot
-- reach anyone until someone deliberately turns them on. Activation is the
-- statement at the bottom of this file, left commented out.
--
-- Placeholders are constrained by the `vars` map each stage builds in
-- send-outreach-drip. renderTemplate replaces an unknown placeholder with an
-- empty string rather than failing, so an out-of-scope one is a silent blank in
-- a real email, not an error:
--   outreach_verify  → business_name, city, owner_name, phone, sender_name,
--                      unsubscribe_url            (NO claim_url — not built yet)
--   outreach_preview → the same, plus claim_url
-- Both bodies below stay inside those sets.

insert into public.outreach_template_variants (email_type, variant_key, subject, body, weight, is_active)
select 'outreach_verify', 'B',
  'A free listing for {{business_name}} — is this the right number?',
  $body$Hi {{owner_name}},

I'm putting together a directory of {{city}} contractors, so homeowners here can find local licensed help directly instead of going through a lead-broker site.

{{business_name}} is on it. Before the page goes live I want to make sure the contact details are right — I have {{phone}}.

Reply YES if that's correct, or tell me what to change. There's no charge and nothing to sign up for. If you'd rather not be listed at all, reply and I'll take it down.

Don't want future emails about this listing? Reply STOP, or unsubscribe here: {{unsubscribe_url}}

Best,
{{sender_name}}$body$,
  1, false
where not exists (
  select 1 from public.outreach_template_variants
  where email_type = 'outreach_verify' and variant_key = 'B'
);

insert into public.outreach_template_variants (email_type, variant_key, subject, body, weight, is_active)
select 'outreach_preview', 'B',
  '{{business_name}} is now listed in {{city}}',
  $body$Hi {{owner_name}},

Your listing is up: {{claim_url}}

Claiming it is free and takes about a minute. What it gets you: when a homeowner asks for a quote through that page, the request comes straight to you. We don't resell it, we don't take a commission, and the phone number on the page is your own — calls come to you, not through us.

If you'd rather not be listed, reply and I'll take it down.

Don't want future emails about this listing? Reply STOP, or unsubscribe here: {{unsubscribe_url}}

Best,
{{sender_name}}$body$,
  1, false
where not exists (
  select 1 from public.outreach_template_variants
  where email_type = 'outreach_preview' and variant_key = 'B'
);

-- To start the A/B test, after reading the copy above:
--   update public.outreach_template_variants set is_active = true where variant_key = 'B';
-- To abandon it:
--   delete from public.outreach_template_variants where variant_key = 'B';
