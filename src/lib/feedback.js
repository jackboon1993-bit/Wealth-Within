import { supabase } from "./supabaseClient";

/**
 * Submits a piece of in-app feedback to the private, write-only `feedback`
 * table. Falls back to a no-op (resolves normally) if Supabase isn't
 * configured, so the feedback button never crashes the app in that case.
 */
export async function submitFeedback({ category, message }) {
  if (!supabase) return true;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("feedback").insert({
    user_id: user ? user.id : null,
    category,
    message,
    created_at: new Date().toISOString(),
  });

  if (error) throw error;
  return true;
}
