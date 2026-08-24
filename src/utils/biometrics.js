import { NativeBiometric } from "capacitor-native-biometric";

// Whether the person has opted into a biometric lock screen on top of their
// existing Supabase session. This is a device-local security preference —
// deliberately NOT stored in profile/Supabase, since it should apply per
// device, not sync across a household or a new phone.
const ENABLED_KEY = "wwa-biometric-enabled";

export function isBiometricEnabled() {
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
  try {
    const result = await NativeBiometric.isAvailable();
    return !!result.isAvailable;
  } catch {
    return false;
  }
}

// Prompts Face ID / fingerprint. Resolves true only on a real successful
// match — any cancellation, failure, or platform error resolves false
// rather than throwing, so callers can treat it as a simple pass/fail.
export async function verifyBiometric() {
  try {
    await NativeBiometric.verifyIdentity({
      reason: "Unlock Wealth Within",
      title: "Unlock",
      subtitle: "Use Face ID or fingerprint to continue",
    });
    return true;
  } catch {
    return false;
  }
}
