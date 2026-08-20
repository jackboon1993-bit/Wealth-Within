// Vercel Cron Job — runs daily.
// Implements the account inactivity retention policy:
//   - 18 months (547 days) with no sign-in → account is FLAGGED for
//     deletion, and app_metadata.inactivity_flagged_at is set.
//   - If the person signs back in after being flagged, the next run of
//     this job clears the flag automatically (their sign-in updates
//     last_sign_in_at, which this job checks).
//   - 30 days after being flagged, with still no sign-in → account and
//     all its data are permanently deleted, via the same deleteUserAccount
//     helper used by the self-service "Delete my account" button.
//
// IMPORTANT — no warning email is sent yet. This project doesn't have a
// transactional email provider configured, so right now the ONLY way a
// person finds out they've been flagged is if they open the app during
// the 30-day window (AuthGate shows a banner in that case). Until a real
// email provider (e.g. Resend) is wired up, someone who doesn't open the
// app in that window gets no warning before deletion. This is a real gap,
// not a stylistic choice — see the code comment on sendInactivityWarningEmail
// below for the easiest way to close it.
//
// Requires a CRON_SECRET environment variable (set it to a long random
// string in Vercel's project settings). Vercel automatically sends this as
// "Authorization: Bearer <CRON_SECRET>" when it triggers this endpoint on
// schedule — without this check, anyone who found this URL could trigger
// mass account deletion, so this check is not optional.

import { createClient } from "@supabase/supabase-js";
import { deleteUserAccount } from "./_lib/deleteUserAccount.js";

const FLAG_AFTER_DAYS = 548; // ~18 months
const DELETE_AFTER_FLAGGED_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Placeholder — currently a no-op. Once a transactional email provider is
// set up (Resend is a common, simple choice that pairs well with Vercel),
// replace the body of this function with a real API call, and the rest of
// this file needs no changes at all — it already calls this at the right
// moment, with the right information.
async function sendInactivityWarningEmail(email, flaggedAt) {
  console.log(`[inactivity-check] would email ${email} — flagged ${flaggedAt}, no email provider configured yet.`);
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || "";
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    res.status(500).json({ error: "Server is not configured for inactivity checks." });
    return;
  }

  const admin = createClient(url, serviceRoleKey);
  const now = Date.now();

  const results = { flagged: 0, unflagged: 0, deleted: 0, checked: 0, errors: [] };

  let page = 1;
  const perPage = 200;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      results.errors.push(`listUsers page ${page}: ${error.message}`);
      break;
    }
    const users = data?.users || [];
    if (users.length === 0) break;

    for (const user of users) {
      results.checked++;
      try {
        await processUser(admin, user, now, results);
      } catch (e) {
        results.errors.push(`user ${user.id}: ${e.message || e}`);
      }
    }

    if (users.length < perPage) break;
    page++;
  }

  res.status(200).json(results);
}

async function processUser(admin, user, now, results) {
  const lastSignInAt = user.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : new Date(user.created_at).getTime();
  const flaggedAt = user.app_metadata?.inactivity_flagged_at ? new Date(user.app_metadata.inactivity_flagged_at).getTime() : null;

  // Signed in more recently than when they were flagged — cancel the flag.
  if (flaggedAt && lastSignInAt > flaggedAt) {
    const { app_metadata } = user;
    const { inactivity_flagged_at, ...rest } = app_metadata || {};
    await admin.auth.admin.updateUserById(user.id, { app_metadata: rest });
    results.unflagged++;
    return;
  }

  // Already flagged and still inactive — check whether the grace period is up.
  if (flaggedAt) {
    const daysSinceFlagged = (now - flaggedAt) / MS_PER_DAY;
    if (daysSinceFlagged >= DELETE_AFTER_FLAGGED_DAYS) {
      const { error } = await deleteUserAccount(admin, user.id);
      if (error) {
        results.errors.push(`delete failed for ${user.id}: ${error.message}`);
      } else {
        results.deleted++;
      }
    }
    return;
  }

  // Not flagged yet — check whether they've crossed the inactivity threshold.
  const daysSinceActive = (now - lastSignInAt) / MS_PER_DAY;
  if (daysSinceActive >= FLAG_AFTER_DAYS) {
    const flaggedAtIso = new Date(now).toISOString();
    await admin.auth.admin.updateUserById(user.id, {
      app_metadata: { ...(user.app_metadata || {}), inactivity_flagged_at: flaggedAtIso },
    });
    await sendInactivityWarningEmail(user.email, flaggedAtIso);
    results.flagged++;
  }
}
