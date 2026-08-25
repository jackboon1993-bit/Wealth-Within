import { NativeBiometric } from "@capgo/capacitor-native-biometric";

// ============================================================================
// TEMPORARILY DISABLED — see handover notes for details.
//
// The underlying native plugin (both capacitor-native-biometric and its
// @capgo fork) has a bug where the biometric prompt's success result never
// makes it back to the JS side on this device/Android version — Capacitor's
// bridge logs "Unable to find a Capacitor plugin to handle requestCode" right
// after a successful fingerprint scan. This happens with two independent
// plugin implementations, so it's a deeper native/bridge-routing issue, not
// something fixable from this file. Needs either a different biometric
// plugin (one that shows the prompt as a dialog on the existing activity
// instead of launching a separate Activity) or a native Android patch.
//
// Setting this to false hides the toggle entirely (isBiometricAvailable
// always reports unavailable) and forces the lock screen off even for
// accounts that already had it switched on from before (isBiometricEnabled
// always reports off) — so no one can get stuck on a broken lock screen.
//
// To re-enable once a fix is in place: set this back to true and remove the
// two early-return short-circuits below.
// ============================================================================
const BIOMETRIC_FEATURE_ENABLED = false;

// Whether the person has opted into a biometric lock screen on top of their
// existing Supabase session. This is a device-local security preference —
// deliberately NOT stored in profile/Supabase, since it should apply per
// device, not sync across a household or a new phone.
const ENABLED_KEY = "wwa-biometric-enabled";

export function isBiometricEnabled() {
  if (!BIOMETRIC_FEATURE_ENABLED) return false;
  try {
    return localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setBiometricEnabled(enabled) {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    /* non-fatal — worst case the toggle doesn't persist */
  }
}

// Check hardware/OS support before showing the toggle as an option — no
// point offering it on a device or simulator with no Face ID/fingerprint
// enrolled.
export async function isBiometricAvailable() {
  if (!BIOMETRIC_FEATURE_ENABLED) return false;
  try {
    const result = await NativeBiometric.isAvailable();
    return !!result.isAvailable;
  } catch {
    return false;
  }
}

// Some devices/OS versions can leave the native verifyIdentity() call
// hanging indefinitely — it never resolves or rejects — typically when the
// prompt fires before the resumed Activity has full focus. Root cause not
// confirmed; this timeout is a safety net so the person is never stuck on
// a "Checking…" screen, not a fix for the underlying hang.
const VERIFY_TIMEOUT_MS = 5000;

function timeout(ms) {
  return new Promise((resolve) => setTimeout(() => resolve("timeout"), ms));
}

// Prompts Face ID / fingerprint. Resolves true only on a real successful
// match — any cancellation, failure, platform error, or timeout resolves
// false rather than throwing, so callers can treat it as a simple pass/fail.
export async function verifyBiometric() {
  try {
    const result = await Promise.race([
      NativeBiometric.verifyIdentity({
        reason: "Unlock Wealth Within",
        title: "Unlock",
        subtitle: "Use Face ID or fingerprint to continue",
      }).then(() => "success"),
      timeout(VERIFY_TIMEOUT_MS),
    ]);
    return result === "success";
  } catch {
    return false;
  }
}
