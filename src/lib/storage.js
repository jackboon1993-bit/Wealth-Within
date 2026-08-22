import { supabase } from "./supabaseClient";

const LOCAL_KEY = "wealth-within-profile-v1";

// Resolved household id, cached for the lifetime of this page load only —
// cleared on sign-out so a second person signing in on the same browser tab
// never accidentally reuses the previous person's household. See
// household-sharing-design.md for the full schema this depends on.
let cachedHouseholdId = null;
if (supabase) {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") cachedHouseholdId = null;
  });
}

/**
 * Resolves the signed-in user's household id, creating a fresh household
 * for them (via the create_household() database function) if they don't
 * belong to one yet. Every existing user gets migrated into a one-person
 * household by the one-off migration SQL, so in practice this only ever
 * creates a new household for a genuinely new sign-up.
 */
async function resolveHouseholdId() {
  if (cachedHouseholdId) return cachedHouseholdId;
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

  if (membership) {
    cachedHouseholdId = membership.household_id;
    return cachedHouseholdId;
  }

  const { data: newHouseholdId, error: createError } = await supabase.rpc("create_household");
  if (createError) throw createError;
  cachedHouseholdId = newHouseholdId;
  return cachedHouseholdId;
}

/**
 * Returns the signed-in user's saved profile object, or null if there is
 * none. Uses Supabase (data lives on the household, isolated by row-level
 * security keyed on household membership) when configured; otherwise falls
 * back to this browser's localStorage, so the app still works with zero
 * setup for a single person on one device.
 */
export async function getData() {
  if (supabase) {
    const householdId = await resolveHouseholdId();
    if (!householdId) return null;
    const { data, error } = await supabase.from("household_data").select("data").eq("household_id", householdId).maybeSingle();
    if (error) throw error;
    return data ? data.data : null;
  }
  const raw = localStorage.getItem(LOCAL_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function setData(value) {
  if (supabase) {
    const householdId = await resolveHouseholdId();
    if (!householdId) throw new Error("Not signed in");
    const { error } = await supabase.from("household_data").upsert({
      household_id: householdId,
      data: value,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    return true;
  }
  localStorage.setItem(LOCAL_KEY, JSON.stringify(value));
  return true;
}

// Clears the household's data (used by "reset to example data") — does NOT
// remove the household itself or anyone's membership in it, so co-members
// and the account stay intact.
export async function deleteData() {
  if (supabase) {
    const householdId = await resolveHouseholdId();
    if (!householdId) return;
    const { error } = await supabase.from("household_data").delete().eq("household_id", householdId);
    if (error) throw error;
    return;
  }
  localStorage.removeItem(LOCAL_KEY);
}

// true once Supabase is configured — used to decide whether to show the
// sign-in screen at all, so the app still runs standalone without it.
export const hasAccounts = Boolean(supabase);
