import { supabase } from "./supabaseClient";
import { API_BASE } from "./apiBase";
import { clearHouseholdCache } from "./storage";

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
 *
 * Household sharing is a Premium feature (see the priority to-do list,
 * "Feature gating"), so this now goes through api/create-household-invite
 * rather than inserting directly — that route checks the household's
 * subscription status server-side before creating a code. A Free
 * household gets a 402 back; check err.code === "premium_required" to
 * show the upgrade prompt rather than a generic error. `householdId` is
 * kept as a parameter for compatibility with existing call sites, but the
 * server resolves the caller's household from their access token itself
 * rather than trusting a client-supplied id.
 */
export async function createInvite(householdId) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not signed in");

  const resp = await fetch(`${API_BASE}/api/create-household-invite`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  const data = await resp.json();
  if (!resp.ok) {
    const err = new Error(data.error || "Couldn't create an invite.");
    if (data.code) err.code = data.code; // e.g. "premium_required"
    throw err;
  }
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
  // BUG FIX: without this, getHouseholdId() elsewhere (BankConnectPanel,
  // the setup wizard's connect step) would keep returning the PREVIOUS
  // household id for the rest of this page load, since storage.js caches
  // it for the session and only clears that cache on sign-out — not on
  // joining/leaving a household mid-session. See leaveHousehold below for
  // the same fix and the fuller root-cause writeup.
  clearHouseholdCache();
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
  // THE BUG: leaving a household changes which household this user
  // belongs to, but storage.js's getHouseholdId() caches the resolved id
  // for the whole page-load lifetime and previously only cleared that
  // cache on a full sign-out. Without this call, BankConnectPanel (both
  // in the setup wizard and the main Connect-a-bank screen) would keep
  // resolving the OLD household id afterward — so a bank connection made
  // right after leaving a household would genuinely complete and save
  // correctly server-side, just against the wrong (stale) household,
  // making it look like connecting "just didn't work" when it actually
  // saved somewhere the app then never looked.
  clearHouseholdCache();
}
