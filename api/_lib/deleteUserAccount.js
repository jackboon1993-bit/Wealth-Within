// Shared "delete everything for this user" logic, used by both the
// self-service delete-account endpoint and the automatic inactivity-cleanup
// cron job, so there's exactly one place that defines what "deleted" means.
//
// `admin` must be a Supabase client created with the service-role key.

export async function deleteUserAccount(admin, userId) {
  // Best-effort cleanup of app data. Wrapped individually so a missing
  // table or an already-empty table never blocks the account deletion
  // itself — the auth user being gone is the part that actually matters
  // for erasure.
  //
  // bank_connections is NOT listed here even though it holds this
  // person's data — it doesn't have a user_id column at all (it's keyed
  // on household_id, one connection per household, since the TrueLayer
  // migration replaced the old Yapily-era schema that did have user_id).
  // It's already cleaned up correctly below: it cascades from households
  // (ON DELETE CASCADE), which the household-aware block only deletes
  // once this person was the household's last member — exactly the
  // right moment, since deleting it any earlier would break the
  // connection for a still-active household partner.
  const tablesKeyedOnUserId = ["feedback"];
  for (const table of tablesKeyedOnUserId) {
    try {
      await admin.from(table).delete().eq("user_id", userId);
    } catch (e) {
      // ignore — table may not exist in this deployment
    }
  }

  // Household-aware cleanup. This person's data may be SHARED with another
  // household member, so deleting their account must never blow away a
  // still-active partner's data — it only removes this person's own
  // membership. The household's data is only actually erased if removing
  // this membership leaves the household with zero members, since at that
  // point nobody else could be affected and full erasure is the correct
  // behaviour (this matters for both GDPR self-deletion and the automatic
  // inactivity-cleanup cron job, which both call this same function).
  try {
    const { data: memberships } = await admin.from("household_members").select("household_id").eq("user_id", userId);
    for (const { household_id } of memberships || []) {
      await admin.from("household_members").delete().eq("household_id", household_id).eq("user_id", userId);
      const { count } = await admin
        .from("household_members")
        .select("user_id", { count: "exact", head: true })
        .eq("household_id", household_id);
      if (!count) {
        // Last member gone — delete the household itself. ON DELETE CASCADE
        // takes household_data and household_invites with it automatically.
        await admin.from("households").delete().eq("id", household_id);
      }
    }
  } catch (e) {
    // ignore — the household tables may not exist yet if the migration
    // SQL hasn't been run against this project
  }

  // profiles keys on "id", not "user_id" — clean it up explicitly too
  // (also covered by the ON DELETE CASCADE on auth.users, but explicit
  // is safer than relying solely on that). This table is kept around as a
  // rollback safety net during the household migration window — see
  // household-sharing-design.md §5 — so it's still cleaned up here even
  // though household_data is now the live source of truth.
  try {
    await admin.from("profiles").delete().eq("id", userId);
  } catch (e) {
    // ignore
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  return { error };
}
