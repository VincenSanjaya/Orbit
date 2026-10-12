import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="error-page">
      <span className="eyebrow">404 / OUT OF ORBIT</span>
      <h1>This page took a different path.</h1>
      <p>Your next move is still waiting.</p>
      <Link className="button primary" href="/">
        Back to ORBIT
      </Link>
    </main>
  );
}
