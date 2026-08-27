-- Remove development page views from the analytics table.
--
-- Restoring the analytics_events write (fecdb9d) was verified against a local
-- dev server, which shares this production Supabase project — so three real
-- rows were filed from http://localhost:5199 and would read as visitor traffic
-- on Admin -> Analytics. The service now refuses to track localhost at all, so
-- this is a one-off cleanup of what landed before that guard existed.
--
-- Scoped to page_url on a loopback origin. A genuine visitor's page_url is
-- always the public site, so nothing real can match. Analytics rows carry no
-- foreign keys and are already pruned on a schedule; deleting these restores
-- the table to exactly its pre-verification state.

delete from public.analytics_events
where page_url ~* '^https?://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?(/|$)';
