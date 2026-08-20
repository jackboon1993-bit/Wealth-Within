// Shared "delete everything for this user" logic, used by both the
// self-service delete-account endpoint and the automatic inactivity-cleanup
// cron job, so there's exactly one place that defines what "deleted" means.
//
// `admin` must be a Supabase client created with the service-role key.

export async function deleteUserAccount(admin, userId) {
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

  const { error } = await admin.auth.admin.deleteUser(userId);
  return { error };
}
