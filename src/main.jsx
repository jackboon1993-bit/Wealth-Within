import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import AuthGate from "./AuthGate.jsx";
import { Sentry } from "./lib/monitoring.js";

function ErrorFallback({ error, resetError }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#F5F2EA",
        fontFamily: "Inter, sans-serif",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 380 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10, color: "#17231F" }}>
          Something went wrong
        </div>
        <p style={{ fontSize: 14, color: "#626B7A", lineHeight: 1.6, marginBottom: 20 }}>
          This has been reported automatically. Your saved data is safe — reloading the page usually
          fixes this.
        </p>
        <button
          onClick={() => {
            resetError();
            window.location.reload();
          }}
          style={{
            background: "#0F6B5C",
            color: "#FFFFFF",
            border: "none",
            borderRadius: 999,
            padding: "12px 28px",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={ErrorFallback}>
      <AuthGate>
        <App />
      </AuthGate>
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);