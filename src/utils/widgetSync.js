import { Preferences } from "@capacitor/preferences";

// Widgets run in a separate process from the app and can't call into your
// JS/React state directly. @capacitor/preferences is the bridge: it writes
// to Android SharedPreferences and iOS UserDefaults, both of which native
// widget code can read on its own. This keeps the widget's data one step
// removed from your full profile — just the handful of numbers it actually
// displays, refreshed whenever totals recalculate.
//
// Android: reads the SharedPreferences file the Preferences plugin writes
// to (default name "CapacitorStorage" — confirm by checking
// /data/data/<your.package>/shared_prefs on a device if the widget shows
// nothing).
// iOS: needs an App Group configured in Xcode (see WIDGET_SETUP.md), since
// widget extensions are sandboxed separately from the host app — standard
// UserDefaults isn't shared between them without one.

const KEYS = {
  netWorth: "widget_net_worth",
  available: "widget_available",
  updatedAt: "widget_updated_at",
};

export async function syncWidgetData(totals) {
  try {
    await Promise.all([
      Preferences.set({ key: KEYS.netWorth, value: String(Math.round(totals.netWorth)) }),
      Preferences.set({ key: KEYS.available, value: String(Math.round(totals.available)) }),
      Preferences.set({ key: KEYS.updatedAt, value: new Date().toISOString() }),
    ]);
  } catch {
    /* non-fatal — widget just shows stale data until the next successful sync */
  }
}
