import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// If no Supabase project is configured, `supabase` is null and the app falls
// back to localStorage (see lib/storage.js) — so it still runs standalone.
export const supabase = url && anonKey ? createClient(url, anonKey) : null;
