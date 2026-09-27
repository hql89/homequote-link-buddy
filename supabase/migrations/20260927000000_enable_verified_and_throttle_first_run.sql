-- Let the 8 newly verified businesses receive outreach, slowly.
--
-- Every business is imported paused, so nothing is emailed until someone
-- decides. These 8 were confirmed by the new location-led rule (or a genuine
-- phone match) and have never received Email 1.
--
-- Only `verified` is enabled. The rows still in needs_review stay paused —
-- the whole point of that queue is that a human has not yet agreed the
-- website belongs to the licence holder, and emailing a stranger to say we
-- have built them a listing is the one mistake worth real care.
--
-- The daily cap drops 5 -> 2 for this first run. Not because 5 is dangerous
-- — it is already a hard cap counted from outreach_sends since UTC midnight
-- — but because this is the first time the B copy is sent to anyone. A copy
-- problem (a broken claim link, a placeholder rendering blank) would
-- otherwise reach five people before anyone read one. At 2, the admin sees
-- the BCC copies of the first two and can stop before the rest.
--
-- Put it back with:
--   update public.admin_settings
--      set setting_value = setting_value || '{"daily_limit": 5}'::jsonb
--    where setting_key = 'outreach_config';
-- or from Admin -> Outreach, which edits the same value.

update public.businesses
   set outreach_paused = false
 where email_confidence = 'verified'
   and outreach_paused
   and outreach_suppressed_at is null
   and outreach_bounced_at is null
   and email_undeliverable_at is null;

update public.admin_settings
   set setting_value = setting_value || '{"daily_limit": 2}'::jsonb,
       updated_at = now()
 where setting_key = 'outreach_config';
