import Link from "next/link";
import { getDict, type Locale } from "@/lib/i18n";
import { OpenWalletButton } from "../WalletProvider";

export function Closing({ locale }: { locale: Locale }) {
  const t = getDict(locale);
  return (
    <section className="closing">
      <div className="wrap">
        <h2 className="grad">{t.closing.h2}</h2>
        <p>{t.closing.p}</p>
        <div className="ctas">
          <Link className="btn lg" href="/chat">
            {t.hero.chat}
          </Link>
          <OpenWalletButton className="btn dark lg">{t.hero.getKey}</OpenWalletButton>
        </div>
      </div>
    </section>
  );
}
