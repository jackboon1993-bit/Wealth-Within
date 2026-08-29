import React, { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { MODE_LABELS, getActiveMode } from "../lib/finance";
import { getHouseholdInfo, renameHousehold, createInvite, joinHousehold, leaveHousehold } from "../lib/household";
import { isBiometricAvailable, isBiometricEnabled, setBiometricEnabled, verifyBiometric } from "../utils/biometrics";

/* Deliberately duplicated from IncomeTab.jsx/BankImportTab.jsx rather than
   imported — AccountPanel is in the main bundle (not lazy-loaded), so
   importing from a lazy chunk would pull that chunk's code into every
   initial page load. Keep this in sync by hand if the visual style ever
   changes. */
function PremiumGate({ subscriptionStatus, onUpgrade, text }) {
  const isLapsed = subscriptionStatus === "canceled" || subscriptionStatus === "past_due";
  return (
    <div className="wmg-premium-gate" style={{ textAlign: "center", padding: "8px 0" }}>
      <div className="wmg-sub" style={{ marginBottom: 10 }}>{text}</div>
      <button className="wmg-btn-primary" onClick={onUpgrade}>
        {isLapsed ? "Renew Premium" : "Try Premium free for 14 days"}
      </button>
    </div>
  );
}

export function HouseholdSection({ onHouseholdChanged, hasPremium, subscriptionStatus, onUpgrade }) {
  const [info, setInfo] = useState(null); // null = loading
  const [errorMsg, setErrorMsg] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [invite, setInvite] = useState(null); // { code, expires_at }
  const [inviteBusy, setInviteBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  // Tracks an explicit 402 "premium_required" from the server, separate
  // from the hasPremium prop — mirrors the pattern in IncomeTab.jsx: trust
  // the server over a possibly-stale client prop (e.g. status just lapsed).
  const [inviteLocked, setInviteLocked] = useState(false);

  const refresh = async () => {
    try {
      const result = await getHouseholdInfo();
      setInfo(result);
      if (result) setNameDraft(result.name);
    } catch (e) {
      setErrorMsg("Couldn't load household info.");
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  if (!supabase) return null;

  const saveName = async () => {
    if (!info || !nameDraft.trim() || nameDraft === info.name) {
      setEditingName(false);
      return;
    }
    try {
      await renameHousehold(info.householdId, nameDraft.trim());
      setEditingName(false);
      await refresh();
    } catch (e) {
      setErrorMsg("Couldn't rename the household.");
    }
  };

  const generateInvite = async () => {
    if (!info) return;
    setInviteBusy(true);
    setErrorMsg("");
    setInviteLocked(false);
    setCopied(false);
    try {
      const result = await createInvite(info.householdId);
      setInvite(result);
    } catch (e) {
      if (e.code === "premium_required") {
        setInviteLocked(true);
      } else {
        setErrorMsg("Couldn't generate an invite code.");
      }
    } finally {
      setInviteBusy(false);
    }
  };

  const copyInvite = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.code);
      setCopied(true);
    } catch (e) {
      /* clipboard permissions may be denied — the code is still shown on screen */
    }
  };

  const doJoin = async () => {
    if (!joinCode.trim()) return;
    setJoinBusy(true);
    setErrorMsg("");
    try {
      await joinHousehold(joinCode.trim());
      setJoinCode("");
      await refresh();
      if (onHouseholdChanged) await onHouseholdChanged();
    } catch (e) {
      setErrorMsg(e.message?.includes("already belong") ? e.message : "That code didn't work — check it's typed correctly and hasn't expired (codes last 7 days).");
    } finally {
      setJoinBusy(false);
    }
  };

  const doLeave = async () => {
    if (!info) return;
    setLeaveBusy(true);
    setErrorMsg("");
    try {
      await leaveHousehold(info.householdId);
      setConfirmingLeave(false);
      await refresh();
      if (onHouseholdChanged) await onHouseholdChanged();
    } catch (e) {
      setErrorMsg("Couldn't leave the household.");
    } finally {
      setLeaveBusy(false);
    }
  };

  return (
    <div className="wmg-household-section">
      <div className="wmg-eyebrow" style={{ marginBottom: 6 }}>Household</div>

      {info === null && !errorMsg && <p className="wmg-sub">Loading…</p>}

      {info && (
        <>
          {editingName ? (
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              <input
                className="wmg-input"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveName()}
                autoFocus
              />
              <button className="wmg-icon-btn" onClick={saveName} aria-label="Save name">✓</button>
            </div>
          ) : (
            <p className="wmg-sub" style={{ margin: "0 0 8px" }}>
              <strong style={{ color: "var(--paper)" }}>{info.name}</strong>{" "}
              <button className="wmg-onboard-skip" style={{ fontSize: 11 }} onClick={() => setEditingName(true)}>Rename</button>
              <br />
              {info.memberCount} member{info.memberCount !== 1 ? "s" : ""} — everyone has full access to the same data.
            </p>
          )}

          {invite ? (
            <div style={{ background: "var(--ink-3)", border: "1px solid var(--hair)", borderRadius: 10, padding: 12, marginBottom: 8 }}>
              <p className="wmg-sub" style={{ margin: "0 0 6px" }}>
                Share this code — anyone who enters it below can join your household. It expires in 7 days.
              </p>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <code style={{ fontSize: 16, fontWeight: 700, letterSpacing: "0.08em", color: "var(--brand)" }}>{invite.code}</code>
                <button className="wmg-onboard-skip" onClick={copyInvite}>{copied ? "Copied ✓" : "Copy"}</button>
              </div>
            </div>
          ) : (!hasPremium || inviteLocked) ? (
            <PremiumGate
              subscriptionStatus={subscriptionStatus}
              onUpgrade={onUpgrade}
              text="Inviting someone to share your household is a Premium feature."
            />
          ) : (
            <button className="wmg-reset-btn" style={{ marginBottom: 8 }} disabled={inviteBusy} onClick={generateInvite}>
              {inviteBusy ? "Generating…" : "Generate invite code"}
            </button>
          )}

          <div className="wmg-account-divider" />

          <div className="wmg-eyebrow" style={{ marginBottom: 6 }}>Join a different household</div>
          <p className="wmg-sub" style={{ margin: "0 0 8px" }}>
            Got a code from someone else? Entering it moves you into their household and away from this one.
          </p>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <input
              className="wmg-input"
              placeholder="Invite code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              disabled={joinBusy}
            />
            <button className="wmg-onboard-skip" disabled={joinBusy || !joinCode.trim()} onClick={doJoin}>
              {joinBusy ? "Joining…" : "Join"}
            </button>
          </div>

          <div className="wmg-account-divider" />

          {confirmingLeave ? (
            <div style={{ display: "flex", gap: 6 }}>
              <button className="wmg-reset-btn danger" disabled={leaveBusy} onClick={doLeave}>
                {leaveBusy ? "Leaving…" : "Yes, leave"}
              </button>
              <button className="wmg-reset-btn" disabled={leaveBusy} onClick={() => setConfirmingLeave(false)}>Cancel</button>
            </div>
          ) : (
            <button className="wmg-reset-btn" onClick={() => setConfirmingLeave(true)}>Leave this household</button>
          )}

          {errorMsg && <p className="wmg-sub" style={{ color: "var(--rust)", marginTop: 8 }}>{errorMsg}</p>}
        </>
      )}

      <div className="wmg-account-divider" />
    </div>
  );
}

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

/* Device-local biometric lock toggle. Deliberately hidden entirely on devices
   with no Face ID/fingerprint enrolled — no point showing a setting that can't
   work. Turning it ON requires passing a real biometric check first, since
   there's no PIN fallback if it's enabled but never actually verified. */
export function BiometricSection() {
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setAvailable(await isBiometricAvailable());
      } catch {
        setAvailable(false);
      }
      setEnabled(isBiometricEnabled());
      setChecking(false);
    })();
  }, []);

  if (checking) return null;
  if (!available) return null;

  const toggle = async () => {
    setErrorMsg("");
    if (enabled) {
      setBiometricEnabled(false);
      setEnabled(false);
      return;
    }
    setBusy(true);
    const ok = await verifyBiometric();
    setBusy(false);
    if (ok) {
      setBiometricEnabled(true);
      setEnabled(true);
    } else {
      setErrorMsg("Couldn't verify — try again.");
    }
  };

  return (
    <div className="wmg-biometric-section">
      <div className="wmg-eyebrow" style={{ marginBottom: 6 }}>App lock</div>
      <p className="wmg-sub" style={{ margin: "0 0 8px" }}>
        {enabled
          ? "Face ID or fingerprint is required to open the app, on top of your password."
          : "Require Face ID or fingerprint to open the app, on top of your password."}
      </p>
      {errorMsg && <p className="wmg-sub" style={{ color: "var(--rust)", margin: "0 0 8px" }}>{errorMsg}</p>}
      <button className="wmg-reset-btn" disabled={busy} onClick={toggle}>
        {busy ? "Checking…" : enabled ? "Turn off biometric lock" : "Turn on biometric lock"}
      </button>
      <div className="wmg-account-divider" />
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
  onHouseholdChanged,
  hasPremium,
  subscriptionStatus,
  onUpgrade,
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
            {["guided", "standard"].map((m) => (
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
      {supabase && (
        <HouseholdSection
          onHouseholdChanged={onHouseholdChanged}
          hasPremium={hasPremium}
          subscriptionStatus={subscriptionStatus}
          onUpgrade={onUpgrade}
        />
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
        Figures are calculated from what you enter, plus your connected bank if you've linked one. Not financial advice.
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
          <BiometricSection />
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


