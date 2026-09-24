import Link from "next/link";
import { brand, tokenTicker } from "@dualyne/config";
import { getDict, href, type Locale } from "@/lib/i18n";
import { Logo } from "./Logo";
import { SocialLinks } from "./Social";

export function Footer({ locale }: { locale: Locale }) {
  const t = getDict(locale).footer;
  const n = getDict(locale).nav;
  const h = (path: string) => href(locale, path);
  return (
    <footer className="big">
      <div className="wrap">
        <div className="fgrid">
          <div>
            <Link className="brand" href={h("/")}>
              <Logo />
              {brand.name}
            </Link>
            <p>{t.blurb}</p>
            <SocialLinks locale={locale} />
          </div>
          <div>
            <h2>{t.product}</h2>
            <ul>
              <li>
                <a href={h("/#compare")}>{n.compare}</a>
              </li>
              <li>
                <a href={h("/#models")}>{n.models}</a>
              </li>
              <li>
                <a href={h("/#pricing")}>{n.pricing}</a>
              </li>
              <li>
                <a href={h("/#models")}>{t.leaderboard}</a>
              </li>
              {brand.tokenEnabled ? (
                <li>
                  <a href={h("/#token")}>{t.treasury}</a>
                </li>
              ) : (
                <li>
                  <Link href="/chat">{t.chat}</Link>
                </li>
              )}
            </ul>
          </div>
          <div>
            <h2>{t.developers}</h2>
            <ul>
              <li>
                <Link href="/docs">{t.documentation}</Link>
              </li>
              <li>
                <Link href={h("/dashboard")}>{n.dashboard}</Link>
              </li>
              <li>
                <a href={h("/#api")}>{n.api}</a>
              </li>
              <li>
                <a href={h("/#faq")}>{n.faq}</a>
              </li>
              <li>
                <a href={h("/status")}>{getDict(locale).statusPage.footer}</a>
              </li>
              {brand.contactEmail && (
                <li>
                  <a href={`mailto:${brand.contactEmail}`}>{t.contact}</a>
                </li>
              )}
            </ul>
          </div>
          {brand.tokenEnabled ? (
            <div>
              <h2>{t.token}</h2>
              <ul>
                <li>
                  <a href={h("/#token")}>{tokenTicker}</a>
                </li>
                <li>
                  <a href={h("/#token")}>{t.feeSplit}</a>
                </li>
                <li>
                  <a href={h("/#token")}>{t.ledger}</a>
                </li>
              </ul>
            </div>
          ) : (
            <div>
              <h2>{t.community}</h2>
              <ul>
                {brand.social.x && (
                  <li>
                    <a href={brand.social.x} target="_blank" rel="noopener">
                      X
                    </a>
                  </li>
                )}
                <li>
                  <a href="https://t.me/dualynebot" target="_blank" rel="noopener">
                    {t.telegramBot}
                  </a>
                </li>
                {brand.social.telegram && (
                  <li>
                    <a href={brand.social.telegram} target="_blank" rel="noopener">
                      Telegram
                    </a>
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
        <div className="fbot">
          <span>
            © {brand.copyrightYear} {brand.name}
            <Link href="/terms">{t.terms}</Link>
            <Link href="/privacy">{t.privacy}</Link>
          </span>
          <span>{t.tagline}</span>
        </div>
      </div>
    </footer>
  );
}
