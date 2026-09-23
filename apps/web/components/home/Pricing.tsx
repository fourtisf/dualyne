import { OpenWalletButton } from "../WalletProvider";
import { Check } from "./Check";

const Tick = ({ hot = false }: { hot?: boolean }) => (
  <Check color={hot ? "#A78BFA" : "#8A8A94"} width={1.7} />
);

export function Pricing() {
  return (
    <section className="block" id="pricing">
      <div className="wrap">
        <div className="head">
          <div className="kick">
            <i />
            Pricing
          </div>
          <h2>Pricing that grows with you.</h2>
          <p>
            Every wallet gets a daily allowance. Holding the token raises it. Past that, pay only for what you
            use.
          </p>
        </div>
        <div className="tiers">
          <div className="tier">
            <div className="nm">Explorer</div>
            <div className="pr">$0</div>
            <p className="who">For anyone with a wallet who wants to try the API.</p>
            <ul>
              <li>
                <Tick />
                20 requests a day
              </li>
              <li>
                <Tick />
                Fast models
              </li>
              <li>
                <Tick />1 API key
              </li>
            </ul>
            <OpenWalletButton className="btn dark">Connect wallet</OpenWalletButton>
          </div>
          <div className="tier hot">
            <div className="nm">
              Holder <span className="pop">Most popular</span>
            </div>
            <div className="pr">
              $0<small>with 100K tokens</small>
            </div>
            <p className="who">For wallets holding the token. Paid for by the treasury.</p>
            <ul>
              <li>
                <Tick hot />
                250 requests a day
              </li>
              <li>
                <Tick hot />
                Every model in the catalog
              </li>
              <li>
                <Tick hot />5 API keys
              </li>
              <li>
                <Tick hot />
                Priority routing
              </li>
            </ul>
            <OpenWalletButton className="btn">Check my wallet</OpenWalletButton>
          </div>
          <div className="tier">
            <div className="nm">Builder</div>
            <div className="pr">
              Cost<small>+ 15%</small>
            </div>
            <p className="who">For apps in production. Top up in USDG or ETH.</p>
            <ul>
              <li>
                <Tick />
                No daily cap
              </li>
              <li>
                <Tick />
                Every model in the catalog
              </li>
              <li>
                <Tick />
                Unlimited API keys
              </li>
              <li>
                <Tick />
                Usage reports per key
              </li>
            </ul>
            <OpenWalletButton className="btn dark">Top up credits</OpenWalletButton>
          </div>
        </div>
        <p className="fine">
          Limits shown are the launch proposal and may change before the token goes live.
        </p>
      </div>
    </section>
  );
}
