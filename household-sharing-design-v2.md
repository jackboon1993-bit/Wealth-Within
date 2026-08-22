# Household/Family Sharing — Design Spec (v2)

Status: **schema designed, app-layer code built and build-verified in the
sandbox (`npm run build` passes clean). Not yet run against live
Supabase** — that part needs your SQL editor open. Go through
`supabase/household-migration.sql` together rather than pasting the whole
thing in blind; the RLS policies and the data-migration block near the end
are worth checking the results of as you go.

Decisions locked in this session:
- All household members get equal, full read/write access — no owner/editor/
  view-only tiers.
- Joining is via a shareable invite code, entered manually in Account
  settings — not a clickable deep-link URL. See §8 for why.
- Real per-field DB enforcement via normalized tables (not app-layer-only
  rules on the existing JSON blob).
- Invite codes expire after 7 days.
- Leaving a household never deletes its data, even if you're the last
  member — it just becomes inaccessible unless someone rejoins. Only an
  actual account deletion (self-service, or the inactivity-cleanup cron —
  see §6) erases a household's data, and only once nobody else is left in it.
- One household per user at a time, enforced at the app layer for
  simplicity. The schema itself doesn't prevent belonging to more than one —
  this isn't a rebuild if that changes later.

---

## 1. Current state (for reference)

One table, `public.profiles`, one row per `auth.uid()`, the whole profile as
a `jsonb` blob, RLS gated on `auth.uid() = id`. No concept of households
anywhere.

## 2. Schema, RLS, and the two security-definer functions

All in `supabase/household-migration.sql`, in the order to run them:
`households`, `household_members`, `household_data`, `household_invites`,
then RLS policies for all four, then `create_household()` and
`join_household(code)`.

The two functions run as `security definer` and do their own validation
inside the function body, rather than relying on a raw table policy to
express "insert a row that grants access to something you don't have access
to yet" — that's the part of an invite-based join flow that's genuinely easy
to get subtly wrong as a plain RLS policy, so it's handled here instead.
Both are called from the client as `supabase.rpc('create_household', {...})`
/ `supabase.rpc('join_household', { invite_code })` — never as raw table
inserts.

## 3. Migration for existing solo users

Also in `household-migration.sql` (§4 of that file): every existing
`profiles` row becomes a one-person household, with its data copied across
unchanged. `profiles` itself is left in place — not dropped — as a rollback
safety net until you've confirmed the new tables are working.

**This block is not safe to run twice** — re-running it would create
duplicate households per user. Run it once, then check the row-count sanity
queries at the bottom of the SQL file.

## 4. App-layer code — built this session

- **`src/lib/storage.js`** — rewritten around a resolved `household_id`
  (looked up via `household_members`, or created via `create_household()`
  for a genuinely new sign-up) instead of `auth.uid()` directly. The
  resolved id is cached in memory for the page load and cleared on sign-out,
  so a second person signing in on the same browser tab never reuses the
  first person's household by accident.
- **`src/lib/household.js`** (new) — `getHouseholdInfo()`,
  `renameHousehold()`, `createInvite()`, `joinHousehold()`,
  `leaveHousehold()`.
- **`src/components/AccountPanel.jsx`** — new `HouseholdSection`: shows the
  household name (editable) and member count, generates/copies an invite
  code, a manual "enter a code to join" field, and a "leave this household"
  action with confirmation.
- **`src/App.jsx`** — wires `HouseholdSection` into both existing
  `AccountPanel` mounts (desktop sidebar + mobile sheet), and adds
  `reloadAfterHouseholdChange()`, which re-fetches and re-applies profile
  data after a join/leave, since at that point the signed-in person's data
  source has genuinely changed.

`npm install && npm run build` succeeds cleanly with all of the above.

## 5. What still needs your live Supabase session

Everything in §2–§3 (the actual SQL) — there is no way to test RLS policies
or a data migration from this sandbox. Once that's run and confirmed
working, the code in §4 should work against it as-is, but the first real
end-to-end test (two accounts, one inviting the other, checking both see
the same data) is worth doing together rather than assuming it's correct
from a clean build alone.

## 6. A live-infrastructure discovery this session — not in the original scoping

While tracing every place `profiles`/`.pension` etc. get touched, I found a
**daily cron job** (`api/inactivity-check.js`) that flags accounts inactive
for 18 months, then deletes them 30 days later if still inactive — sharing
the same `deleteUserAccount()` helper as the self-service "Delete my
account" button. This wasn't mentioned in the original handoff notes, so
it's worth flagging on its own: **before this session's fix, both delete
paths deleted `profiles` by `id = userId`.** Once data lives in a shared
`household_data` row, that would have meant one inactive household member
being auto-deleted wipes the entire household's data — including an active
partner's.

**Fixed as part of this session's build:** `api/_lib/deleteUserAccount.js`
now removes only the deleted person's own `household_members` row. The
household's data is only actually erased if that removal leaves the
household with zero members — at which point nobody else could be affected,
and full erasure is the correct behaviour for both GDPR self-deletion and
the automatic inactivity path. This is intentionally different from
"leaving" a household (§ decisions above, and `leaveHousehold()` in
`household.js`), which never deletes data even as the last member, since
leaving keeps your account (and the option to rejoin) alive.

## 7. Sensible next test once the SQL is live

1. Run the migration, check the sanity-query row counts match.
2. Sign in as an existing (pre-migration) user — confirm their data still
   loads exactly as before.
3. Generate an invite code from that account, sign in as a second (new or
   different existing) account, enter the code, confirm both accounts now
   see the same data and both can edit it.
4. Have the second account leave — confirm the first account's data is
   untouched and still accessible.
5. Delete the second account entirely (self-service) while a member of a
   shared household — confirm the first account's data survives.

## 8. Why invite is a manual code, not a clickable link

A clickable `?join=CODE` deep link would need new URL-handling code across
`AuthGate.jsx`/`App.jsx` (capture the param before sign-in, hold it through
sign-up/email-confirmation, apply it after) — a genuinely separate, harder-
to-verify-blind piece of work than the RLS/migration above. A manually
copy-pasted code satisfies "shareable" without that extra surface area. Easy
to add later as a pure convenience layer on top of the same
`joinHousehold(code)` function, without touching the schema again.

## 9. "One household at a time" — enforced at the source

Rather than leave this as a pure UI convention, `join_household()` now
rejects the call outright (clear error message, surfaced in the UI as-is)
if the caller already belongs to a household — so it's not possible to end
up in two via a stray call, only via the deliberate "leave, then join
elsewhere" flow the UI actually offers.
