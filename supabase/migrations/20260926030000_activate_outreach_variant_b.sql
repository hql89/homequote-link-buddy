-- Switch outreach to the B copy, and retire A.
--
-- Not an A/B split, which is what the B variants were seeded for on
-- 2026-08-27. The numbers do not support one: at the observed ~31% enrichment
-- hit rate there are roughly 145 usable addresses left in the whole
-- directory, so a 50/50 split gives ~70 per arm — far too few to separate a
-- real difference in opt-out rate from noise.
--
-- And A has already had its trial: 31 sends, 3 unsubscribes, 1 bounce, 0
-- replies expressing interest, 0 listings claimed. Spending half of what
-- remains re-establishing that is waste.
--
-- A is deactivated rather than deleted. outreach_sends rows reference
-- variant_key, so the history stays readable, and reverting is one update.

update public.outreach_template_variants
   set is_active = true, updated_at = now()
 where variant_key = 'B';

update public.outreach_template_variants
   set is_active = false, updated_at = now()
 where variant_key = 'A';

-- Fail the migration rather than leave a stage with nothing to send.
-- pickOutreachVariant returns null when no variant is active, and
-- send-outreach-drip then skips that stage and logs the reason — correct
-- behaviour, but a silent halt of the whole campaign is not what this change
-- is meant to do, and it would not be obvious from the outside.
do $do$
declare
  v_missing text;
begin
  select string_agg(t.email_type, ', ')
    into v_missing
    from (values ('outreach_verify'), ('outreach_preview')) as t(email_type)
   where not exists (
     select 1 from public.outreach_template_variants v
      where v.email_type = t.email_type and v.is_active and v.weight > 0
   );

  if v_missing is not null then
    raise exception 'No active, positively-weighted variant left for: %', v_missing;
  end if;
end
$do$;
