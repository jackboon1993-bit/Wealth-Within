import { createClient } from "@supabase/supabase-js";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Supabase's default session storage is window.localStorage. In the
// native Android app that's scoped to the embedded WebView's
// https://localhost origin — the same origin that already needed special
// handling for relative fetch() calls and CORS (see apiBase.js). Android
// can reclaim a backgrounded WebView's storage under memory pressure,
// especially while another app/browser has foreground focus — exactly
// what happens during "connect a bank", where TrueLayer's OAuth flow
// backgrounds the app for as long as it takes to pick a bank, log in,
// and approve consent. If that reclaim happens, a localStorage-only
// session is gone on return — not because the person signed out, but
// because it was never durably persisted — and AuthGate correctly (but
// confusingly) falls back to the sign-in screen.
//
// Capacitor's Preferences plugin persists to native SharedPreferences
// (Android) / UserDefaults (iOS) instead of WebView storage, which
// survives this kind of reclaim far more reliably. It's already used
// elsewhere in the app, so this adds no new dependency — just a thin
// adapter matching the { getItem, setItem, removeItem } shape
// supabase-js expects for a custom storage implementation.
const capacitorPreferencesStorage = {
  getItem: async (key) => {
    const { value } = await Preferences.get({ key });
    return value;
  },
  setItem: async (key, value) => {
    await Preferences.set({ key, value });
  },
  removeItem: async (key) => {
    await Preferences.remove({ key });
  },
};

// Web keeps the default (localStorage-backed) behaviour, unchanged —
// this only swaps storage on the native platform, where the failure
// mode above actually applies.
const authOptions = Capacitor.isNativePlatform()
  ? { persistSession: true, autoRefreshToken: true, storage: capacitorPreferencesStorage }
  : { persistSession: true, autoRefreshToken: true };

// If no Supabase project is configured, `supabase` is null and the app falls
// back to localStorage (see lib/storage.js) — so it still runs standalone.
export const supabase = url && anonKey ? createClient(url, anonKey, { auth: authOptions }) : null;
