import { supabase } from "./supabaseClient";

const LOCAL_KEY = "wealth-within-profile-v1";

// Resolved household id, cached for the lifetime of this page load only —
// cleared on sign-out so a second person signing in on the same browser tab
// never accidentally reuses the previous person's household. See
// household-sharing-design.md for the full schema this depends on.
//
// BUG FOUND: this cache was ONLY ever cleared on SIGNED_OUT — never when
// household membership changes without a full sign-out (e.g. leaving/
// removing a household link mid-session). That meant every place that
// calls getHouseholdId() (SetupWizard's "connect" step, ImportTab's main
// Connect-a-bank panel) kept resolving the OLD household id after a
// removal, so a bank connection made afterward genuinely completed and
// saved successfully server-side — just against the stale household, not
// the real current one. Nothing showed as connected because the app was
// then checking the correct (new) household for accounts that were
// actually saved under the old one. clearHouseholdCache() below is the
// fix — whatever code performs "remove household link" / "leave
// household" must call it immediately after that action succeeds, so the
// next getHouseholdId() call re-resolves fresh instead of returning the
// stale value.
let cachedHouseholdId = null;
// Deduplicates concurrent calls to resolveHouseholdId() below. Without
// this, two components mounting at nearly the same moment (e.g. ImportTab
// and SetupWizard both checking on load) could each see cachedHouseholdId
// as empty, each find no existing membership, and each independently call
// create_household() — creating two (or more) separate households for
// the same person instead of one. Every caller now shares this single
// in-flight promise instead of racing their own lookups.
let inFlightResolve = null;
if (supabase) {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") cachedHouseholdId = null;
  });
}

// Call this immediately after any action that changes which household
// the signed-in user belongs to WITHOUT a full sign-out — leaving a
// shared household, being removed from one, or anything else that
// changes household_members for the current user mid-session. The next
// getHouseholdId() call will then re-resolve from the database instead
// of returning the old cached id.
export function clearHouseholdCache() {
  cachedHouseholdId = null;
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
  // A resolution is already running (from another component that called
  // this a moment ago) — share its result instead of starting a second,
  // competing one. This is the actual fix for the race: every concurrent
  // caller awaits the exact same promise, so only one of them ever
  // reaches the "no membership found, create one" branch below.
  if (inFlightResolve) return inFlightResolve;

  inFlightResolve = (async () => {
    try {
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
    } finally {
      // Whether it succeeded or threw, this specific resolution attempt
      // is over — clear the slot so a genuinely new call later (e.g.
      // after clearHouseholdCache()) can start its own fresh lookup
      // rather than being stuck sharing a long-finished promise.
      inFlightResolve = null;
    }
  })();

  return inFlightResolve;
}

// Exposed so UI components that need the household id directly (e.g.
// BankConnectPanel, which passes it through to TrueLayer's `state` param)
// can get it without duplicating the membership-lookup/create logic above.
export { resolveHouseholdId as getHouseholdId };

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

// Subscribes to live changes on this household's data row, so a second
// person's edits show up without either of you reloading the app. Resolves
// the household id internally (reusing the same cache as getData/setData),
// then opens a Supabase Realtime channel filtered to just that row.
// Requires Realtime replication to be enabled on household_data in the
// Supabase dashboard (Database > Replication) — this is a project setting,
// not something this function can turn on itself.
//
// onRemoteChange is called with the raw `data` payload whenever a change
// arrives from anyone (including, harmlessly, this same client's own
// writes echoing back). Returns an unsubscribe function.
export function subscribeToHouseholdData(onRemoteChange) {
  if (!supabase) return () => {};
  let channel = null;
  let cancelled = false;

  resolveHouseholdId().then((householdId) => {
    if (cancelled || !householdId) return;
    channel = supabase
      .channel(`household_data_${householdId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "household_data", filter: `household_id=eq.${householdId}` },
        (payload) => {
          const row = payload.new;
          if (row && row.data) onRemoteChange(row.data);
        }
      )
      .subscribe();
  });

  return () => {
    cancelled = true;
    if (channel) supabase.removeChannel(channel);
  };
}

// true once Supabase is configured — used to decide whether to show the
// sign-in screen at all, so the app still runs standalone without it.
export const hasAccounts = Boolean(supabase);
