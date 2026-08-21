import React, { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { MODE_LABELS, getActiveMode } from "../lib/finance";

export function MfaSection() {
  const [factors, setFactors] = useState(null); // null = loading
  const [enrolling, setEnrolling] = useState(false);
  const [qrCode, setQrCode] = useState(null);
  const [secret, setSecret] = useState(null);
  const [factorId, setFactorId] = useState(null);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("idle"); // idle | busy | error
  const [errorMsg, setErrorMsg] = useState("");

  const refreshFactors = async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors(data?.totp || []);
  };

  useEffect(() => {
    refreshFactors();
  }, []);

  const startEnroll = async () => {
    setStatus("idle");
    setErrorMsg("");
    setCode("");
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator app" });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setQrCode(data.totp.qr_code);
    setSecret(data.totp.secret);
    setFactorId(data.id);
    setEnrolling(true);
  };

  const confirmEnroll = async () => {
    setStatus("busy");
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) {
      setStatus("error");
      setErrorMsg("That code didn't match — check your authenticator app and try again.");
      return;
    }
    setEnrolling(false);
    setQrCode(null);
    setSecret(null);
    setCode("");
    setFactorId(null);
    setStatus("idle");
    setErrorMsg("");
    await refreshFactors();
  };

  const cancelEnroll = async () => {
    // Clean up the unverified factor rather than leaving it dangling on the account.
    if (factorId) {
      try {
        await supabase.auth.mfa.unenroll({ factorId });
      } catch (e) {
        /* best effort */
      }
    }
    setEnrolling(false);
    setQrCode(null);
    setSecret(null);
    setCode("");
    setFactorId(null);
    setStatus("idle");
    setErrorMsg("");
  };

  const removeFactor = async (id) => {
    setStatus("busy");
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    if (error) {
      setErrorMsg(error.message);
      setStatus("error");
      return;
    }
    setStatus("idle");
    setErrorMsg("");
    await refreshFactors();
  };

  if (!supabase) return null;
  const hasFactor = factors && factors.length > 0;

  return (
    <div className="wmg-mfa-section">
      <div className="wmg-mfa-title">Two-factor authentication</div>

      {factors === null && <p className="wmg-sub">Checking status…</p>}

      {factors !== null && !enrolling && (
        hasFactor ? (
          <>
            <p className="wmg-sub" style={{ color: "var(--sage)" }}>✓ Enabled — an authenticator app is required to sign in.</p>
            {errorMsg && <p className="wmg-sub" style={{ color: "var(--rust)" }}>{errorMsg}</p>}
            {factors.map((f) => (
              <button
                key={f.id}
                className="wmg-reset-btn"
                style={{ marginTop: 6, color: "var(--rust)", borderColor: "var(--rust)" }}
                disabled={status === "busy"}
                onClick={() => removeFactor(f.id)}
              >
                Turn off 2FA
              </button>
            ))}
          </>
        ) : (
          <>
            <p className="wmg-sub">
              Not enabled. Add an authenticator app (Google Authenticator, Authy, 1Password, etc.) for an extra layer
              of protection on top of your password.
            </p>
            {errorMsg && <p className="wmg-sub" style={{ color: "var(--rust)" }}>{errorMsg}</p>}
            <button className="wmg-reset-btn" style={{ marginTop: 6 }} onClick={startEnroll}>
              Turn on 2FA
            </button>
          </>
        )
      )}

      {enrolling && (
        <div className="wmg-mfa-enroll">
          <p className="wmg-sub">Scan this with your authenticator app:</p>
          {qrCode && (
            <img
              src={qrCode}
              alt="Scan with your authenticator app"
              className="wmg-mfa-qr"
            />
          )}
          <p className="wmg-sub" style={{ wordBreak: "break-all" }}>
            Or enter this key manually: <strong>{secret}</strong>
          </p>
          <input
            className="wmg-input"
            style={{ marginTop: 8, marginBottom: 8 }}
            placeholder="6-digit code"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
          {status === "error" && <p className="wmg-sub" style={{ color: "var(--rust)" }}>{errorMsg}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="wmg-onboard-next"
              style={{ flex: 1 }}
              disabled={code.length !== 6 || status === "busy"}
              onClick={confirmEnroll}
            >
              {status === "busy" ? "Checking…" : "Confirm"}
            </button>
            <button className="wmg-reset-btn" onClick={cancelEnroll} disabled={status === "busy"}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* Account settings — sync status, feedback, MFA, reset, sign out, and account
   deletion. Rendered in two places (desktop sidebar, mobile account modal) so
   these actions are reachable regardless of screen size. */

export function AccountPanel({
  storageStatus,
  profile,
  setField,
  onOpenFeedback,
  confirmingReset,
  setConfirmingReset,
  resetData,
  confirmingDeleteAccount,
  setConfirmingDeleteAccount,
  deleteAccountText,
  setDeleteAccountText,
  deleteAccountStatus,
  deleteAccountNow,
}) {
  const activeMode = getActiveMode(profile);
  return (
    <div className="wmg-account-panel">
      {profile && setField && (
        <>
          <div className="wmg-eyebrow" style={{ marginBottom: 6 }}>App experience</div>
          <p className="wmg-sub" style={{ margin: "0 0 10px" }}>
            Choose how much detail the app shows by default. This never changes your figures — only how they're presented.
          </p>
          <div className="wmg-mode-toggle" role="group" aria-label="App experience">
            {["guided", "standard", "advanced"].map((m) => (
              <button
                key={m}
                type="button"
                className={`wmg-mode-toggle-btn ${activeMode === m ? "active" : ""}`}
                aria-pressed={activeMode === m}
                onClick={() => setField(["preferredMode"])(m)}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
          <div className="wmg-account-divider" />
        </>
      )}
      <div className="wmg-sync-row">
        <span className={`wmg-sync-dot status-${storageStatus}`} />
        <span>
          {storageStatus === "loading" && "Loading your data…"}
          {storageStatus === "ready" && (supabase ? "Saved to your account" : "Saved on this device")}
          {storageStatus === "saving" && "Saving…"}
          {storageStatus === "saved" && (supabase ? "Saved to your account" : "Saved on this device")}
          {storageStatus === "error" && "Couldn't save — check connection"}
        </span>
      </div>
      <p style={{ margin: "10px 0" }}>
        Figures are calculated from what you enter. Not connected to any bank, and not financial advice.
      </p>
      <p style={{ margin: "0 0 10px" }}>
        <a href="/privacy.html" target="_blank" rel="noopener" style={{ color: "var(--brand)", fontWeight: 600 }}>Privacy</a>
        {" · "}
        <a href="/terms.html" target="_blank" rel="noopener" style={{ color: "var(--brand)", fontWeight: 600 }}>Terms</a>
      </p>
      <button
        className="wmg-reset-btn"
        style={{ marginBottom: 8, borderColor: "var(--brand)", color: "var(--brand)" }}
        onClick={onOpenFeedback}
      >
        Send feedback
      </button>
      {confirmingReset ? (
        <div style={{ display: "flex", gap: 6 }}>
          <button className="wmg-reset-btn danger" onClick={resetData}>Yes, reset</button>
          <button className="wmg-reset-btn" onClick={() => setConfirmingReset(false)}>Cancel</button>
        </div>
      ) : (
        <button className="wmg-reset-btn" onClick={() => setConfirmingReset(true)}>Reset to example data</button>
      )}
      {supabase && (
        <>
          <div className="wmg-account-divider" />
          <MfaSection />
          <div className="wmg-account-divider" />
          <button className="wmg-reset-btn" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
          <div style={{ marginTop: 8 }}>
            {!confirmingDeleteAccount ? (
              <button
                className="wmg-reset-btn"
                style={{ color: "var(--rust)", borderColor: "var(--rust)" }}
                onClick={() => setConfirmingDeleteAccount(true)}
              >
                Delete my account
              </button>
            ) : (
              <div style={{ background: "var(--ink-3)", border: "1px solid var(--hair)", borderRadius: 10, padding: 12 }}>
                <p className="wmg-sub" style={{ margin: "0 0 8px", fontWeight: 600, color: "var(--rust)" }}>
                  This permanently deletes your account and all your data. It can't be undone.
                </p>
                <p className="wmg-sub" style={{ margin: "0 0 8px" }}>
                  Type <strong>DELETE</strong> to confirm.
                </p>
                <input
                  className="wmg-input"
                  style={{ marginBottom: 8 }}
                  value={deleteAccountText}
                  onChange={(e) => setDeleteAccountText(e.target.value)}
                  placeholder="DELETE"
                  disabled={deleteAccountStatus === "deleting"}
                />
                {deleteAccountStatus === "error" && (
                  <p className="wmg-sub" style={{ color: "var(--rust)", margin: "0 0 8px" }}>
                    Something went wrong — please try again, or contact support if it keeps happening.
                  </p>
                )}
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    className="wmg-reset-btn danger"
                    disabled={deleteAccountText !== "DELETE" || deleteAccountStatus === "deleting"}
                    onClick={deleteAccountNow}
                  >
                    {deleteAccountStatus === "deleting" ? "Deleting…" : "Permanently delete"}
                  </button>
                  <button
                    className="wmg-reset-btn"
                    disabled={deleteAccountStatus === "deleting"}
                    onClick={() => setConfirmingDeleteAccount(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}


