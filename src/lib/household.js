import { supabase } from "./supabaseClient";

/**
 * Fetches the current household's name, member count, and whether the
 * signed-in person is its original creator (shown in the UI only — being
 * the creator carries no extra permissions, everyone has equal access).
 * Returns null if Supabase isn't configured, nobody's signed in, or the
 * household migration SQL hasn't been run against this project yet.
 */
export async function getHouseholdInfo() {
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership, error: membershipError } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) return null;

  const householdId = membership.household_id;

  const [{ data: household, error: householdError }, { data: members, error: membersError }] = await Promise.all([
    supabase.from("households").select("id, name, owner_id, created_at").eq("id", householdId).maybeSingle(),
    supabase.from("household_members").select("user_id, joined_at").eq("household_id", householdId),
  ]);
  if (householdError) throw householdError;
  if (membersError) throw membersError;

  return {
    householdId,
    name: household?.name || "My household",
    memberCount: members?.length ?? 0,
    isCreator: household?.owner_id === user.id,
    currentUserId: user.id,
  };
}

/** Renames the household. Any member can do this — no owner-only gate. */
export async function renameHousehold(householdId, name) {
  const { error } = await supabase.from("households").update({ name }).eq("id", householdId);
  if (error) throw error;
}

/**
 * Generates a fresh invite code for the household, valid for 7 days.
 * Anyone holding the code can join — there's no email check — so treat it
 * like any other shareable link and only send it to people you actually
 * want in the household.
 */
export async function createInvite(householdId) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("household_invites")
    .insert({ household_id: householdId, created_by: user.id })
    .select("code, expires_at")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Joins a household using an invite code, via the join_household() database
 * function (validates the code server-side rather than a raw insert).
 * Returns the new household id on success.
 */
export async function joinHousehold(code) {
  const { data, error } = await supabase.rpc("join_household", { invite_code: code.trim() });
  if (error) throw error;
  return data;
}

/**
 * Leaves the current household. The account itself is untouched — only
 * membership is removed. If this is the last remaining member, the
 * household's data is deliberately NOT deleted — it just becomes
 * inaccessible unless someone rejoins later. Nothing is destroyed by
 * leaving; only "Delete my account" (or the inactivity cleanup job) can
 * actually erase a household's data, and only once nobody else is left in
 * it — see household-sharing-design.md for the reasoning.
 */
export async function leaveHousehold(householdId) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("household_members").delete().eq("household_id", householdId).eq("user_id", user.id);
  if (error) throw error;
}
