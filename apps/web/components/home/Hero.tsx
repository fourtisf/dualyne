import type { CSSProperties } from "react";
import type { CatalogModel } from "@refract/shared";
import { CompareConsole } from "../CompareConsole";
import { OpenWalletButton } from "../WalletProvider";
import { Check } from "./Check";

const d = (v: string) => ({ "--d": v }) as CSSProperties;

export function Hero({ models, blindMode }: { models: CatalogModel[]; blindMode: "optional" | "always" }) {
  return (
    <section className="hero">
      <div className="wrap">
        <div className="hero-text">
          <a className="badge rise" href="#api" style={d(".05s")}>
            <b>New</b>OpenAI-compatible API is in early access
          </a>
          <h1 className="grad rise" style={d(".12s")}>
            Every AI model.
            <br />
            One prompt away.
          </h1>
          <p className="lede rise" style={d(".24s")}>
            Send one prompt to two models at once and compare them side by side. When you find the one you
            like, ship it with a single key.
          </p>
          <div className="ctas rise" style={d(".34s")}>
            <a className="btn lg" href="#compare">
              Start comparing
            </a>
            <OpenWalletButton className="btn dark lg">Get an API key</OpenWalletButton>
          </div>
          <div className="trust rise" style={d(".42s")}>
            <span>
              <Check />
              No signup to try
            </span>
            <span>
              <Check />
              OpenAI-compatible
            </span>
            <span>
              <Check />
              Keys revocable instantly
            </span>
            <span>
              <Check />
              Public treasury ledger
            </span>
          </div>
        </div>
        <CompareConsole models={models} blindMode={blindMode} />
      </div>
    </section>
  );
}
