# Plan: Make "Outreach emails sent" and "Replies received" open real lists

## The problem right now
- The **"Outreach emails sent"** card already links to `/admin/outreach` — but that page is the *template editor* (subject/body of your two form emails, daily limit, etc.). It has no list of the individual emails that actually went out. There's nowhere in the app to see "who got emailed, when, with what subject."
- The **"Replies received"** card links to `/admin/replies`, which *is* a real list with full message content — but it only shows **unhandled** replies. The moment you click "Mark handled," it disappears from the page for good. So the "Open" links in Recent Activity go stale, and there's no way to look back at a reply you already dealt with.

## What I'll build

### 1. New page: Sent Emails (`/admin/outreach/sent`)
A new admin page listing individual outreach sends, most recent first, paginated (50 at a time, "Load more").

Each row shows: send time, recipient email, business name — city, which email (Email 1 verification / Email 2 preview + A/B version), and status (sent / failed, with the error if it failed).

Clicking a row expands it to show the **exact subject line that was actually sent** (this is stored, so it's 100% real) and a **reconstructed body** — rendered right now from the current template + that business's info. I'll label this clearly as reconstructed, with a one-line note that it may not match word-for-word if you've edited the template or the business's name/city/phone since that email went out (the real sent body text isn't stored anywhere — only the subject is). That's an honest limitation, not a bug I'm introducing.

Data source: the existing `email_send_log` table (already has real recipient + real subject, admin-read RLS policy already exists — no migration needed), joined to `businesses` for name/city and to `outreach_sends` for which template version was used.

The "Outreach emails sent" KPI card on Overview, and the "Sent a verification/preview email" Recent Activity rows, will link here instead of to the settings page. The settings page itself is unchanged.

### 2. Replies page gets an "Unhandled / All" toggle
Small change to the existing `/admin/replies` page (no new page — it already does everything needed once you can see handled ones too): add a toggle so you can switch from the default "Unhandled" view to "All," which includes replies you've already marked handled. Same full-content display it already has, just not disappearing forever.

This also fixes the Recent Activity "Open" links for replies — right now they point at `/admin/replies`, which only works if that reply is still unhandled.

## Files touched
- **New:** `src/pages/admin/OutreachSent.tsx` — the sent-emails list/detail page
- `src/App.tsx` — register route `/admin/outreach/sent`, lazy import
- `src/pages/admin/Overview.tsx` — repoint the two hrefs (KPI card + recent-activity items)
- `src/pages/admin/Replies.tsx` — add the Unhandled/All toggle, drop the hardcoded `.is("handled_at", null)` filter when "All" is selected
- `src/integrations/supabase/directory.ts` — a small typed helper to read `email_send_log` rows (matching the pattern already used for `outreach_sends`/`inbound_emails`)

## Not doing
- Not adding a "resend" or "delete" action — this is read-only, matching what you asked for ("see and open them").
- Not storing rendered email bodies going forward — that's a real gap (the exact body of a sent email is genuinely gone once sent) but it's a separate, bigger change to the sending job itself. I'll flag it as a follow-up, not bundle it in here.

## Test / verify
- Load `/admin/outreach/sent` in the browser preview, confirm the one existing sent row (the `outreach_verify` email) renders with real recipient/subject and an expandable reconstructed body.
- Load `/admin/replies`, mark a reply handled, confirm it vanishes from "Unhandled" but reappears under "All."
- Click through both Overview KPI cards and confirm they land on the right page.

## Rollback
Pure UI addition + two href changes, no schema changes. Revert the commit if anything's wrong — nothing destructive.
