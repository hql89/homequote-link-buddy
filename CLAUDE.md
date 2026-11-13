# HomeQuoteLink — working rules

## Database writes: direct SQL vs migrations

The Supabase MCP connection in `.mcp.json` is **writable** (`read_only=false`,
granted by the owner 2026-11-13). It was read-only before that, which is why
older notes and backlog entries say every write must go through a migration.
That is no longer mechanically true, and the rule below is what replaced it.

**Schema changes still go through a migration. Always.**
Tables, columns, constraints, indexes, RLS policies, grants, functions, cron
jobs — anything that changes the shape of the database or who can reach it.
Write it in `supabase/migrations/`, include a rollback, and apply it with
`npm run sb:push`. A migration is reviewable, repeatable and undoable; an
ad-hoc `ALTER` is none of those and leaves no record of what changed or why.

**Direct SQL is for data, and only data.**
Fixing a wrong value, clearing test rows, backfilling a field, investigating.
Things where the "what changed" is the row, not the structure.

Why the split: this project has shipped a broken admin write three times
because a column grant was missing (see `docs/bugs.md`). That class of bug is
caught by writing the change down and reading it back. Convenience on schema
changes is exactly where it would cost the most.

**Before any direct write**, run the `SELECT` first and look at what it
returns. The `WHERE` clause that matches more rows than you expected is the
one that hurts.

**Deletes still prompt the owner.** That is a separate safety layer, not a
permission setting, and it is not something to work around.

## Related

- `docs/ENHANCEMENTS.md` — open work, newest findings at the top of each entry.
- `docs/bugs.md` — what has actually broken here, and why.
- Edge functions deploy with `npm run sb:deploy <name>`, never the bare CLI
  (wrong-project risk).
