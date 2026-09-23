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
          <a className="btn lg" href="#compare">
            {t.hero.start}
          </a>
          <OpenWalletButton className="btn dark lg">{t.hero.getKey}</OpenWalletButton>
        </div>
      </div>
    </section>
  );
}
