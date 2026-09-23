"use client";

import { useT } from "./LocaleProvider";

export function ErrorView({ reset }: { reset: () => void }) {
  const t = useT().error;
  return (
    <main className="view">
      <div className="wrap">
        <div className="gate">
          <h2>{t.title}</h2>
          <p>{t.text}</p>
          <button className="btn lg" type="button" onClick={reset}>
            {t.retry}
          </button>
        </div>
      </div>
    </main>
  );
}
