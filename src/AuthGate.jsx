import React, { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";

/**
 * Wraps the app with a sign-in / sign-up screen when Supabase is configured.
 * If it isn't configured (no env vars set), this renders children straight
 * away and the app runs standalone against localStorage — handy for local
 * development or a single-user deployment with no accounts at all.
 */
export default function AuthGate({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (!supabase) return children;
  if (session === undefined) return <FullScreenMessage text="Loading…" />;
  if (!session) return <SignInScreen />;
  return children;
}

function FullScreenMessage({ text }) {
  return (
    <div style={styles.page}>
      <p style={{ color: "#626B7A", fontFamily: "Inter, sans-serif", fontSize: 14 }}>{text}</p>
    </div>
  );
}

function SignInScreen() {
  const [mode, setMode] = useState("signin"); // signin | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState({ type: null, message: "" });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setStatus({ type: null, message: "" });
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setStatus({ type: "success", message: "Check your email to confirm your account, then sign in." });
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setStatus({ type: "error", message: err.message || "Something went wrong." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={styles.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        .wwa-input { width: 100%; box-sizing: border-box; background: #F0F1F4; color: #171B21; border: 1px solid #E2E5EA; border-radius: 7px; padding: 11px 12px; font-family: 'Inter', sans-serif; font-size: 13.5px; margin-bottom: 12px; }
        .wwa-input:focus { outline: 2px solid #9A752B; outline-offset: 1px; }
        .wwa-btn { width: 100%; background: #171B21; color: #FFFFFF; border: none; border-radius: 7px; padding: 12px; font-family: 'Inter', sans-serif; font-size: 13.5px; font-weight: 600; cursor: pointer; }
        .wwa-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .wwa-switch { background: none; border: none; color: #9A752B; font-family: 'Inter', sans-serif; font-size: 12.5px; cursor: pointer; padding: 0; }
      `}</style>
      <div style={styles.card}>
        <div style={styles.brandRow}>
          <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
            <defs>
              <linearGradient id="authBrandGrad" x1="0" y1="0" x2="34" y2="34" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#B5924C" />
                <stop offset="100%" stopColor="#8A6A22" />
              </linearGradient>
            </defs>
            <rect width="34" height="34" rx="9" fill="url(#authBrandGrad)" />
            <path d="M8 21.5 13.2 15l4 4.2L26 10" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <circle cx="26" cy="10" r="1.8" fill="#FFFFFF" />
          </svg>
          <div>
            <div style={{ fontFamily: "Inter, sans-serif", fontWeight: 800, fontSize: 17, letterSpacing: "-0.02em", color: "#171B21" }}>
              Wealth Within
            </div>
            <div style={{ fontFamily: "Inter, sans-serif", fontSize: 10.5, color: "#626B7A" }}>Household finance, in one place</div>
          </div>
        </div>

        <h2 style={styles.heading}>{mode === "signup" ? "Create your account" : "Sign in"}</h2>

        <form onSubmit={submit}>
          <input
            className="wwa-input"
            type="email"
            placeholder="Email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="wwa-input"
            type="password"
            placeholder="Password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="wwa-btn" type="submit" disabled={busy}>
            {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        {status.message && (
          <p style={{ fontSize: 12.5, marginTop: 12, color: status.type === "error" ? "#B23B2E" : "#227A56", fontFamily: "Inter, sans-serif" }}>
            {status.message}
          </p>
        )}

        <p style={{ marginTop: 18, fontSize: 12.5, fontFamily: "Inter, sans-serif", color: "#626B7A" }}>
          {mode === "signup" ? "Already have an account?" : "New here?"}{" "}
          <button className="wwa-switch" onClick={() => setMode(mode === "signup" ? "signin" : "signup")}>
            {mode === "signup" ? "Sign in" : "Create an account"}
          </button>
        </p>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#F4F5F7",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    background: "#FFFFFF",
    border: "1px solid #E2E5EA",
    borderRadius: 14,
    padding: 28,
    boxShadow: "0 1px 2px rgba(23,27,33,0.04), 0 8px 24px rgba(23,27,33,0.06)",
  },
  brandRow: { display: "flex", alignItems: "center", gap: 11, marginBottom: 22 },
  heading: { fontFamily: "Inter, sans-serif", fontSize: 16, fontWeight: 700, color: "#171B21", margin: "0 0 16px" },
};
