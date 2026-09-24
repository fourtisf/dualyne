import Link from "next/link";
import { brand } from "@dualyne/config";
import { getDict, type Locale } from "@/lib/i18n";
import { OpenWalletButton } from "../WalletProvider";
import { Check } from "./Check";

const Tick = ({ hot = false }: { hot?: boolean }) => (
  <Check color={hot ? "#A78BFA" : "#8A8A94"} width={1.7} />
);

export function Pricing({ locale }: { locale: Locale }) {
  const t = getDict(locale).pricing;
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
        <div className="tiers">
          {!brand.tokenEnabled && (
            <div className="tier hot">
              <div className="nm">
                {t.chatName} <span className="pop">{t.startHere}</span>
              </div>
              <div className="pr">$0</div>
              <p className="who">{t.chatWho}</p>
              <ul>
                {t.chatItems.map((x) => (
                  <li key={x}>
                    <Tick hot />
                    {x}
                  </li>
                ))}
              </ul>
              <Link className="btn" href="/chat">
                {t.chatCta}
              </Link>
            </div>
          )}
          <div className="tier">
            <div className="nm">Explorer</div>
            <div className="pr">$0</div>
            <p className="who">{t.explorerWho}</p>
            <ul>
              {t.explorerItems.map((x) => (
                <li key={x}>
                  <Tick />
                  {x}
                </li>
              ))}
            </ul>
            <OpenWalletButton className="btn dark">{t.explorerCta}</OpenWalletButton>
          </div>
          {brand.tokenEnabled && (
            <div className="tier hot">
              <div className="nm">
                Holder <span className="pop">{t.popular}</span>
              </div>
              <div className="pr">
                $0<small>{t.withTokens}</small>
              </div>
              <p className="who">{t.holderWho}</p>
              <ul>
                {t.holderItems.map((x) => (
                  <li key={x}>
                    <Tick hot />
                    {x}
                  </li>
                ))}
              </ul>
              <OpenWalletButton className="btn">{t.holderCta}</OpenWalletButton>
            </div>
          )}
          <div className="tier">
            <div className="nm">Builder</div>
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
        <p className="fine">{t.fine}</p>
      </div>
    </section>
  );
}
