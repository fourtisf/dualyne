import Link from "next/link";
import { getDict, href, type Locale } from "@/lib/i18n";

export function NotFoundView({ locale }: { locale: Locale }) {
  const t = getDict(locale).notFound;
  return (
    <main className="view">
      <div className="wrap">
        <div className="gate">
          <h2>{t.title}</h2>
          <p>{t.text}</p>
          <Link className="btn lg" href={href(locale, "/")}>
            {t.home}
          </Link>
        </div>
      </div>
    </main>
  );
}
