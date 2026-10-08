'use client';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="narrow wrap">
      <h1>Something went wrong</h1>
      <p className="muted">The page could not load. This is usually GitHub or the database being unreachable. Nothing was lost.</p>
      {error.digest && <p className="small muted">Reference: <code>{error.digest}</code></p>}
      <button className="btn" onClick={reset}>Try again</button>
    </main>
  );
}
