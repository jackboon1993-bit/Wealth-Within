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
  const [aal, setAal] = useState(null); // null = not checked yet, otherwise { current, next }

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Whenever we have a session, check whether this specific session still
  // needs a second-factor challenge before it's fully authenticated. This
  // re-runs on every session change (fresh sign-in, or a restored session on
  // page load) but not on every render, since a session that's already at
  // aal2 doesn't need re-checking until it changes again.
  useEffect(() => {
    if (!supabase || !session) {
      setAal(null);
      return;
    }
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => {
      if (data) setAal({ current: data.currentLevel, next: data.nextLevel });
    });
  }, [session]);

  if (!supabase) return children;
  if (session === undefined) return <FullScreenMessage text="Loading…" />;
  if (!session) return <SignInScreen />;
  // aal === null means we have a session but haven't yet heard back from
  // getAuthenticatorAssuranceLevel(). Treat that as "still checking", not
  // "no challenge needed" — otherwise there's a brief window on sign-in /
  // page load where the app renders before we know MFA is required.
  if (aal === null) return <FullScreenMessage text="Loading…" />;

  const needsChallenge = aal.current === "aal1" && aal.next === "aal2";
  if (needsChallenge) return <MfaChallengeScreen onVerified={() => setAal({ current: "aal2", next: "aal2" })} />;

  const flaggedAt = session.user?.app_metadata?.inactivity_flagged_at;
  return (
    <>
      {flaggedAt && <InactivityBanner flaggedAt={flaggedAt} />}
      {children}
    </>
  );
}

function MfaChallengeScreen({ onVerified }) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("idle"); // idle | busy | error
  const [errorMsg, setErrorMsg] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setStatus("busy");
    setErrorMsg("");
    const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();
    if (factorsError || !factorsData?.totp?.length) {
      setStatus("error");
      setErrorMsg("Couldn't find your authenticator setup. Try signing in again.");
      return;
    }
    const factorId = factorsData.totp[0].id;
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) {
      setStatus("error");
      setErrorMsg("That code didn't match — check your authenticator app and try again.");
      return;
    }
    onVerified();
  };

  return (
    <div style={styles.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
        .wwa-input { width: 100%; box-sizing: border-box; background: #2A2A5C; color: #F3F1FF; border: 1px solid #363068; border-radius: 14px; padding: 12px 14px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 13.5px; margin-bottom: 12px; letter-spacing: 0.1em; text-align: center; }
        .wwa-input:focus { outline: 2px solid #8B5CF6; outline-offset: 1px; }
        .wwa-btn { width: 100%; background: linear-gradient(135deg, #8B5CF6, #FF6FA5); color: #FFFFFF; border: none; border-radius: 999px; padding: 13px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 13.5px; font-weight: 700; cursor: pointer; box-shadow: 0 10px 24px -10px rgba(60,30,140,0.6); }
        .wwa-btn:disabled { opacity: 0.6; cursor: not-allowed; }
      `}</style>
      <div style={styles.card}>
        <div style={styles.brandRow}>
          <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
            <defs>
              <linearGradient id="mfaBrandGrad" x1="0" y1="0" x2="34" y2="34" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#FF6FA5" />
                <stop offset="100%" stopColor="#7C4DFF" />
              </linearGradient>
            </defs>
            <rect width="34" height="34" rx="10" fill="url(#mfaBrandGrad)" />
            <path d="M8 21.5 13.2 15l4 4.2L26 10" stroke="#FFFFFF" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <circle cx="26" cy="10" r="1.9" fill="#FFCE6B" />
          </svg>
          <div>
            <div style={{ fontFamily: "'Baloo 2', sans-serif", fontWeight: 700, fontSize: 18, letterSpacing: "-0.01em", color: "#F3F1FF" }}>
              Wealth Within
            </div>
          </div>
        </div>
        <h2 style={styles.heading}>Enter your code</h2>
        <p style={{ fontSize: 12.5, color: "#9C97C4", fontFamily: "'Plus Jakarta Sans', sans-serif", margin: "0 0 16px" }}>
          Open your authenticator app and enter the 6-digit code for Wealth Within.
        </p>
        <form onSubmit={submit}>
          <input
            className="wwa-input"
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
          <button className="wwa-btn" type="submit" disabled={code.length !== 6 || status === "busy"}>
            {status === "busy" ? "Checking…" : "Verify"}
          </button>
        </form>
        {status === "error" && (
          <p style={{ fontSize: 12.5, marginTop: 12, color: "#FF5C7A", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            {errorMsg}
          </p>
        )}
      </div>
    </div>
  );
}

function InactivityBanner({ flaggedAt }) {
  const deleteDate = new Date(new Date(flaggedAt).getTime() + 30 * 24 * 60 * 60 * 1000);
  const dateLabel = deleteDate.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return (
    <div style={styles.banner}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700&display=swap');`}</style>
      <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        <strong>This account hasn't been used in a while.</strong> To keep your data safe, it's scheduled for
        deletion on <strong>{dateLabel}</strong> unless you keep using the app — just being signed in now cancels it
        automatically.
      </span>
    </div>
  );
}

function FullScreenMessage({ text }) {
  return (
    <div style={styles.page}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');`}</style>
      <p style={{ color: "#9C97C4", fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 14 }}>{text}</p>
    </div>
  );
}

function SignInScreen() {
  const [mode, setMode] = useState("signin"); // signin | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState({ type: null, message: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem("wwa-account-deleted")) {
      sessionStorage.removeItem("wwa-account-deleted");
      setStatus({ type: "success", message: "Your account and all your data have been permanently deleted." });
    }
  }, []);

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
        @import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
        .wwa-input { width: 100%; box-sizing: border-box; background: #2A2A5C; color: #F3F1FF; border: 1px solid #363068; border-radius: 14px; padding: 12px 14px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 13.5px; margin-bottom: 12px; }
        .wwa-input::placeholder { color: #9C97C4; }
        .wwa-input:focus { outline: 2px solid #8B5CF6; outline-offset: 1px; }
        .wwa-btn { width: 100%; background: linear-gradient(135deg, #8B5CF6, #FF6FA5); color: #FFFFFF; border: none; border-radius: 999px; padding: 13px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 13.5px; font-weight: 700; cursor: pointer; box-shadow: 0 10px 24px -10px rgba(60,30,140,0.6); transition: filter .15s ease, transform .15s ease; }
        .wwa-btn:hover:not(:disabled) { filter: brightness(1.08); transform: translateY(-1px); }
        .wwa-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .wwa-switch { background: none; border: none; color: #FF6FA5; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 12.5px; font-weight: 600; cursor: pointer; padding: 0; }
      `}</style>
      <div style={styles.card}>
        <div style={styles.brandRow}>
          <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
            <defs>
              <linearGradient id="authBrandGrad" x1="0" y1="0" x2="34" y2="34" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#FF6FA5" />
                <stop offset="100%" stopColor="#7C4DFF" />
              </linearGradient>
            </defs>
            <rect width="34" height="34" rx="10" fill="url(#authBrandGrad)" />
            <path d="M8 21.5 13.2 15l4 4.2L26 10" stroke="#FFFFFF" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <circle cx="26" cy="10" r="1.9" fill="#FFCE6B" />
          </svg>
          <div>
            <div style={{ fontFamily: "'Baloo 2', sans-serif", fontWeight: 700, fontSize: 18, letterSpacing: "-0.01em", color: "#F3F1FF" }}>
              Wealth Within
            </div>
            <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 10.5, color: "#9C97C4" }}>Household finance, in one place</div>
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
          <p style={{ fontSize: 12.5, marginTop: 12, color: status.type === "error" ? "#FF5C7A" : "#4FD1C5", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            {status.message}
          </p>
        )}

        <p style={{ marginTop: 18, fontSize: 12.5, fontFamily: "'Plus Jakarta Sans', sans-serif", color: "#9C97C4" }}>
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
  banner: {
    background: "linear-gradient(135deg, #8B5CF6, #FF6FA5)",
    color: "#FFFFFF",
    padding: "12px 20px",
    fontSize: 13,
    lineHeight: 1.5,
    textAlign: "center",
  },
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#1A1A3D",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    background: "#21214A",
    border: "1px solid #363068",
    borderRadius: 22,
    padding: 28,
    boxShadow: "0 1px 2px rgba(15,15,45,0.2), 0 20px 40px -12px rgba(15,15,45,0.5)",
  },
  brandRow: { display: "flex", alignItems: "center", gap: 11, marginBottom: 22 },
  heading: { fontFamily: "'Baloo 2', sans-serif", fontSize: 18, fontWeight: 700, color: "#F3F1FF", margin: "0 0 16px" },
};
