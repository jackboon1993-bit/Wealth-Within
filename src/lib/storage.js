import { supabase } from "./supabaseClient";

const LOCAL_KEY = "wealth-within-profile-v1";

/**
 * Returns the signed-in user's saved profile object, or null if there is none.
 * Uses Supabase (one row per user, isolated by row-level security) when
 * configured; otherwise falls back to this browser's localStorage, so the
 * app still works with zero setup for a single person on one device.
 */
export async function getData() {
  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase.from("profiles").select("data").eq("id", user.id).maybeSingle();
    if (error) throw error;
    return data ? data.data : null;
  }
  const raw = localStorage.getItem(LOCAL_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function setData(value) {
  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not signed in");
    const { error } = await supabase.from("profiles").upsert({
      id: user.id,
      data: value,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    return true;
  }
  localStorage.setItem(LOCAL_KEY, JSON.stringify(value));
  return true;
}

export async function deleteData() {
  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("profiles").delete().eq("id", user.id);
    if (error) throw error;
    return;
  }
  localStorage.removeItem(LOCAL_KEY);
}

// true once Supabase is configured — used to decide whether to show the
// sign-in screen at all, so the app still runs standalone without it.
export const hasAccounts = Boolean(supabase);
