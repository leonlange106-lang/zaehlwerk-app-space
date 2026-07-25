"use client";

// Last-resort boundary: catches errors thrown in the ROOT layout itself, where
// the normal error.tsx (which renders inside the layout) can't help. It replaces
// the whole document, so it must ship its own <html>/<body> and cannot rely on
// the theme provider or globals.css — hence plain inline styles and no
// design-system imports.

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="de">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#f8fafc",
          color: "#0f172a",
        }}
      >
        <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Die Anwendung ist abgestürzt</h1>
          <p style={{ fontSize: 14, color: "#64748b", marginBottom: 20 }}>
            Beim Laden der Seite ist ein schwerwiegender Fehler aufgetreten. Bitte lade die Seite neu.
          </p>
          {error.digest && (
            <p style={{ fontSize: 12, color: "#94a3b8", fontFamily: "monospace", marginBottom: 20 }}>
              Referenz: {error.digest}
            </p>
          )}
          <button
            onClick={() => reset()}
            style={{
              padding: "8px 16px",
              fontSize: 14,
              borderRadius: 6,
              border: "none",
              background: "#0f172a",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Seite neu laden
          </button>
        </div>
      </body>
    </html>
  );
}
