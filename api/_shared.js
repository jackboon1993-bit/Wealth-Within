// Shared helpers for the /api/bank/* serverless functions.
// Not itself an API route — imported by the others.
//
// Uses Yapily (https://yapily.com) as the Open Banking provider. Auth is
// simple HTTP Basic (Application Key as username, Application Secret as
// password) — no separate token exchange step needed, unlike some other
// providers.

import { createClient } from "@supabase/supabase-js";

const YAPILY_BASE = "https://api.yapily.com";

/**
 * Validates the Supabase access token sent by the browser (Authorization:
 * Bearer <token>) and returns a Supabase client scoped to that user, plus
 * the user's id. Row-level security policies then apply exactly as if the
 * browser had made the request directly, so a user can only ever read or
 * write their own bank_connections row.
 */
export async function requireUser(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    const err = new Error("Not signed in.");
    err.status = 401;
    throw err;
  }

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    const err = new Error("Server is not configured with Supabase credentials.");
    err.status = 500;
    throw err;
  }

  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) {
    const err = new Error("Not signed in.");
    err.status = 401;
    throw err;
  }

  return { supabase, userId: user.id };
}

function basicAuthHeader() {
  const key = process.env.YAPILY_APP_KEY;
  const secret = process.env.YAPILY_APP_SECRET;
  if (!key || !secret) {
    const err = new Error("Server is not configured with Yapily credentials.");
    err.status = 500;
    throw err;
  }
  return `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
}

export async function yapilyFetch(path, options = {}) {
  const resp = await fetch(`${YAPILY_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: basicAuthHeader(),
      "Content-Type": "application/json;charset=UTF-8",
      Accept: "application/json;charset=UTF-8",
    },
  });
  return resp;
}
