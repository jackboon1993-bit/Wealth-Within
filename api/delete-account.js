// Vercel Serverless Function.
// Permanently deletes the signed-in user's account: their profile data,
// feedback, any bank connections, and the Supabase Auth account itself.
// This is a genuine "delete everything" action, not just clearing the
// profile row — GDPR right-to-erasure needs the login/identity gone too,
// not just the app data.
//
// The service-role key (full database access, bypasses row-level security)
// lives ONLY here, server-side. It must be set in Vercel as a plain
// environment variable named SUPABASE_SERVICE_ROLE_KEY — never prefixed
// with VITE_, or it would be bundled into the browser and exposed publicly.
//
// The actual deletion logic lives in _lib/deleteUserAccount.js, shared with
// the automatic inactivity-cleanup cron job, so there's one definition of
// "deleted" for both the self-service and automatic paths.

import { createClient } from "@supabase/supabase-js";
import { deleteUserAccount } from "./_lib/deleteUserAccount.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    res.status(500).json({ error: "Server is not configured for account deletion." });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Not signed in." });
    return;
  }

  // Service-role client: bypasses RLS, and can also validate the caller's
  // own access token to find out who they are before touching anything.
  const admin = createClient(url, serviceRoleKey);

  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(token);

  if (userError || !user) {
    res.status(401).json({ error: "Not signed in." });
    return;
  }

  const { error: deleteError } = await deleteUserAccount(admin, user.id);
  if (deleteError) {
    console.error("delete-account: failed to delete auth user", deleteError);
    res.status(502).json({ error: "Couldn't fully delete the account. Please try again or contact support." });
    return;
  }

  res.status(200).json({ success: true });
}
