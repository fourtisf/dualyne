"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="view">
      <div className="wrap">
        <div className="gate">
          <h2>Something went wrong</h2>
          <p>This page hit an error. Try again, and if it keeps happening, come back in a few minutes.</p>
          <button className="btn lg" type="button" onClick={reset}>
            Try again
          </button>
        </div>
      </div>
    </main>
  );
}
