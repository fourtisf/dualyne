import Link from "next/link";

export default function NotFound() {
  return (
    <main className="view">
      <div className="wrap">
        <div className="gate">
          <h2>This page doesn&apos;t exist</h2>
          <p>The link may be old, or the address may have a typo.</p>
          <Link className="btn lg" href="/">
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
