import { supabase } from "./supabaseClient";

async function authedFetch(path, options = {}) {
  if (!supabase) throw new Error("Bank linking needs an account — please make sure you're signed in.");
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Please sign in again to connect a bank.");

  const resp = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...(options.headers || {}),
    },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

export async function startBankConnection() {
  return authedFetch("/api/bank/create-requisition", {
    method: "POST",
    body: JSON.stringify({ origin: window.location.origin }),
  });
}

export async function completeBankConnection() {
  return authedFetch("/api/bank/complete-requisition", { method: "POST" });
}

export async function disconnectBank() {
  return authedFetch("/api/bank/disconnect", { method: "POST" });
}

export async function getBankConnection() {
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from("bank_connections").select("*").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  return data;
}
