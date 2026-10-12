'use client';
import { useEffect } from 'react';
export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="error-page">
      <span className="eyebrow">A MOMENTARY INTERRUPTION</span>
      <h1>Let’s get back on course.</h1>
      <p>Your account data is saved. Try loading this page again.</p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
