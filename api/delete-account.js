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

import { createClient } from "@supabase/supabase-js";

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

  const userId = user.id;

  // Best-effort cleanup of app data. Wrapped individually so a missing
  // table (e.g. bank_connections, if that SQL was never run) or an
  // already-empty table never blocks the account deletion itself — the
  // auth user being gone is the part that actually matters for erasure.
  const tablesKeyedOnUserId = ["feedback", "bank_connections"];
  for (const table of tablesKeyedOnUserId) {
    try {
      await admin.from(table).delete().eq("user_id", userId);
    } catch (e) {
      // ignore — table may not exist in this deployment
    }
  }
  // profiles keys on "id", not "user_id" — clean it up explicitly too
  // (also covered by the ON DELETE CASCADE on auth.users, but explicit
  // is safer than relying solely on that).
  try {
    await admin.from("profiles").delete().eq("id", userId);
  } catch (e) {
    // ignore
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    console.error("delete-account: failed to delete auth user", deleteError);
    res.status(502).json({ error: "Couldn't fully delete the account. Please try again or contact support." });
    return;
  }

  res.status(200).json({ success: true });
}
