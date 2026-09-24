import Link from "next/link";
import { brand } from "@dualyne/config";
import { publicConfig } from "@/lib/config";
import { getDict, type Locale } from "@/lib/i18n";
import { UpgradeButton } from "../ProDialog";
import { OpenWalletButton } from "../WalletProvider";
import { Check } from "./Check";

const Tick = ({ hot = false }: { hot?: boolean }) => (
  <Check color={hot ? "#A78BFA" : "#8A8A94"} width={1.7} />
);

export function Pricing({ locale }: { locale: Locale }) {
  const t = getDict(locale).pricing;
  const c = publicConfig;
  return (
    <section className="block" id="pricing">
      <div className="wrap">
        <div className="head">
          <div className="kick">
            <i />
            {t.kick}
          </div>
          <h2>{t.h2}</h2>
          <p>{t.p}</p>
        </div>
        <div className={brand.tokenEnabled ? "tiers four" : "tiers"}>
          <div className="tier">
            <div className="nm">{t.freeName}</div>
            <div className="pr">
              $0<small>{t.forever}</small>
            </div>
            <p className="who">{t.freeWho}</p>
            <ul>
              {t.freeItems(c.freeChatPerDay).map((x) => (
                <li key={x}>
                  <Tick />
                  {x}
                </li>
              ))}
            </ul>
            <Link className="btn dark" href="/chat">
              {t.chatCta}
            </Link>
          </div>
          <div className="tier hot">
            <div className="nm">
              {t.proName} <span className="pop">{t.popular}</span>
            </div>
            <div className="pr">
              ${c.proPriceUsd}
              <small>{t.perDays(c.proDays)}</small>
            </div>
            <p className="who">{t.proWho}</p>
            <ul>
              {t.proItems(c.proChatPerDay, c.proPremiumPerDay).map((x) => (
                <li key={x}>
                  <Tick hot />
                  {x}
                </li>
              ))}
            </ul>
            <UpgradeButton className="btn">{t.proCta}</UpgradeButton>
          </div>
          {brand.tokenEnabled && (
            <div className="tier">
              <div className="nm">Holder</div>
              <div className="pr">
                $0<small>{t.withTokens}</small>
              </div>
              <p className="who">{t.holderWho}</p>
              <ul>
                {t.holderItems.map((x) => (
                  <li key={x}>
                    <Tick />
                    {x}
                  </li>
                ))}
              </ul>
              <OpenWalletButton className="btn dark">{t.holderCta}</OpenWalletButton>
            </div>
          )}
          <div className="tier">
            <div className="nm">{t.apiName}</div>
            <div className="pr">
              {t.cost}
              <small>+ 15%</small>
            </div>
            <p className="who">{t.builderWho}</p>
            <ul>
              {t.builderItems.map((x) => (
                <li key={x}>
                  <Tick />
                  {x}
                </li>
              ))}
            </ul>
            <OpenWalletButton className="btn dark">{t.builderCta}</OpenWalletButton>
          </div>
        </div>
        <p className="fine">{t.fine(c.proDays)}</p>
      </div>
    </section>
  );
}
