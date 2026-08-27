// src/lib/apiBase.js
//
// The native Android/iOS app runs its JS from a local https://localhost/
// address (Capacitor's WebView), not from wealth-within.vercel.app. Any
// fetch("/api/...") call with a relative path silently resolves against
// that local address instead — which has no server behind it — and fails
// instantly. This was the root cause of "Couldn't load account data"
// persisting in the native app even after the bank connection itself was
// confirmed working on the website.
//
// On the website, API_BASE is "" so relative paths behave exactly as
// before. On native, it's the real deployed domain, so the same relative
// path resolves correctly.

import { Capacitor } from "@capacitor/core";

export const API_BASE = Capacitor.isNativePlatform() ? "https://wealth-within.vercel.app" : "";
