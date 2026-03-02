"use client";

/**
 * Root-level error boundary. Catches errors in the root layout.
 */

export default function GlobalError({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by Next.js error boundary signature
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            padding: "2rem",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            Something went wrong
          </h2>
          <p style={{ color: "#6b7280", marginBottom: "1rem" }}>
            An unexpected error occurred. Please try again.
          </p>
          <button
            onClick={reset}
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "#2563eb",
              color: "white",
              borderRadius: "0.375rem",
              border: "none",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
