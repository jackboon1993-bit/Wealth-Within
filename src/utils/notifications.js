import { LocalNotifications } from "@capacitor/local-notifications";

// Local, on-device notifications only — no server, no FCM/APNs. These fire
// based on checks done whenever the app is open and recalculating totals,
// not on a background schedule. Good enough for "you just crossed a
// threshold" nudges; not able to alert someone who hasn't opened the app.

const STORAGE_KEY = "wwa-notified-thresholds";

// Tracks which (categoryId, threshold) pairs we've already fired for this
// month, so recalculating totals on every keystroke doesn't spam repeat
// notifications. Keyed by month so it naturally resets each month.
function loadNotifiedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveNotifiedState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* non-fatal — worst case we re-notify once */
  }
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}`;
}

export async function requestNotificationPermission() {
  try {
    const result = await LocalNotifications.requestPermissions();
    return result.display === "granted";
  } catch {
    return false;
  }
}

export async function areNotificationsEnabled() {
  try {
    const result = await LocalNotifications.checkPermissions();
    return result.display === "granted";
  } catch {
    return false;
  }
}

let notificationIdCounter = 1;

async function fireNotification(title, body) {
  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: notificationIdCounter++,
          title,
          body,
          schedule: { at: new Date(Date.now() + 500) }, // near-immediate
        },
      ],
    });
  } catch {
    /* silently skip if permission wasn't granted or platform unsupported */
  }
}

// Call this whenever `profile.expenseCategories` changes. Checks each
// budgeted category's actual spend against its budget and fires a
// notification the first time it crosses 80%, then again the first time it
// crosses 100%, per category, per month.
export async function checkCategoryBudgets(expenseCategories) {
  const enabled = await areNotificationsEnabled();
  if (!enabled) return;

  const month = currentMonthKey();
  const state = loadNotifiedState();
  if (state.month !== month) {
    state.month = month;
    state.fired = {};
  }
  state.fired = state.fired || {};

  for (const cat of expenseCategories) {
    const budget = Number(cat.budget || 0);
    if (budget <= 0) continue; // no budget set for this category — nothing to check

    const spend = cat.items.reduce((sum, i) => sum + Number(i.amount || 0), 0);
    const pct = spend / budget;
    const key = cat.id;
    state.fired[key] = state.fired[key] || {};

    if (pct >= 1 && !state.fired[key].hundred) {
      await fireNotification(
        "Budget reached",
        `${cat.name} has hit its ${budget >= 1000 ? "£" + Math.round(budget) : "£" + budget} budget for this month.`
      );
      state.fired[key].hundred = true;
    } else if (pct >= 0.8 && !state.fired[key].eighty) {
      await fireNotification(
        "Approaching budget",
        `${cat.name} is at ${Math.round(pct * 100)}% of its monthly budget.`
      );
      state.fired[key].eighty = true;
    }
  }

  saveNotifiedState(state);
}
