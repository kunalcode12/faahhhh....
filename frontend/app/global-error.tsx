"use client";

/**
 * Last line of defence: replaces the root layout when even that fails, so it
 * carries its own document and minimal inline styles (no globals.css here).
 */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en-GB">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
          background: "#f9f9f7",
          color: "#0b0b0b",
        }}
      >
        <title>Beaufort is unavailable</title>
        <main style={{ maxWidth: 480, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 40, fontWeight: 900, letterSpacing: "-0.03em", margin: 0 }}>
            Beaufort hit a problem
          </h1>
          <p style={{ color: "#52514e", lineHeight: 1.5 }}>
            The app failed to load. Please try again in a moment.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: 16,
              padding: "10px 18px",
              borderRadius: 12,
              border: 0,
              background: "#0b0b0b",
              color: "#f9f9f7",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
