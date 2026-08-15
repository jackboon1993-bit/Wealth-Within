import * as Sentry from "@sentry/react";

const dsn = import.meta.env.VITE_SENTRY_DSN;

// If no Sentry DSN is configured, this quietly does nothing — errors just
// aren't reported anywhere. Set VITE_SENTRY_DSN (see .env.example) to turn
// monitoring on.
export const monitoringEnabled = Boolean(dsn);

if (dsn) {
  Sentry.init({
    dsn,
    // Sends a small sample of normal page loads too, so you can see
    // whether the app is slow for people, not just when it breaks.
    tracesSampleRate: 0.2,
  });
}

export { Sentry };