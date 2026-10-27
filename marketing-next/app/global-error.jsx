"use client";

/* Minimal global-error boundary per the Next.js 16 file-convention docs:
   global-error must be a Client Component and defines its own <html>/<body>.
   The built-in _global-error fails to prerender on this setup (useContext of
   null during export), so the app ships its own. */
export default function GlobalError({ error, retry }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "monospace", padding: "4rem 2rem", background: "#f6f1e7", color: "#14161c" }}>
        <h2 style={{ fontSize: "1.4rem" }}>Something went wrong.</h2>
        <p style={{ opacity: 0.7 }}>{error?.digest ? `digest: ${error.digest}` : ""}</p>
        <button onClick={() => retry()} style={{ padding: "10px 18px", cursor: "pointer" }}>
          Try again
        </button>
      </body>
    </html>
  );
}
