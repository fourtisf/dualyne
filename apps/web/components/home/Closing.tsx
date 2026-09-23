import { OpenWalletButton } from "../WalletProvider";

export function Closing() {
  return (
    <section className="closing">
      <div className="wrap">
        <h2 className="grad">Find your model in one prompt.</h2>
        <p>Free to try. No signup.</p>
        <div className="ctas">
          <a className="btn lg" href="#compare">
            Start comparing
          </a>
          <OpenWalletButton className="btn dark lg">Get an API key</OpenWalletButton>
        </div>
      </div>
    </section>
  );
}
