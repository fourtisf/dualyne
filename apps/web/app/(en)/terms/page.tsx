import type { Metadata } from "next";
import Link from "next/link";
import { brand, tokenTicker } from "@dualyne/config";

// Draft terms. Have them reviewed by a lawyer (including governing law and the legal entity)
// before public launch.
export const metadata: Metadata = {
  title: "Terms of Service",
  description: brand.tokenEnabled
    ? `The rules for using ${brand.name}, its API and the ${tokenTicker} token.`
    : `The rules for using ${brand.name}: Chat, Compare, the Telegram bot and the API.`,
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  const contact = brand.contactEmail;
  return (
    <main className="view">
      <div className="wrap">
        <article className="prose legal">
          <h1 className="grad">Terms of Service</h1>
          <p className="upd">Last updated September 24, 2026</p>
          <p>
            These terms apply to {brand.domain}, Chat, the Compare tool, the Telegram bot (@dualynebot) and
            the {brand.name} API (together, the &quot;Service&quot;), run by {brand.legalName}. By using the
            Service you agree to them. If you don&apos;t agree, don&apos;t use the Service.
          </p>

          <h2>Early access</h2>
          <p>
            The Service is in early access. Features, models, limits and prices can change or be removed at
            any time, and there is no guarantee of availability. Limits shown on the site are the launch
            proposal.
          </p>

          <h2>Who can use it</h2>
          <p>
            You must be at least 18 and allowed to use the Service under the laws where you live. You may not
            use it if you are subject to sanctions, or from a place where it would be illegal.
          </p>

          <h2>Acceptable use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>break the law, or use the Service to harm, harass, deceive or exploit anyone;</li>
            <li>
              break the usage policies of OpenRouter or of the model providers, which apply to everything you
              send;
            </li>
            <li>get around limits, for example by using many wallets or keys to multiply free allowances;</li>
            <li>attack, overload, scrape or probe the Service, or interfere with other users;</li>
            <li>resell or share free access without our written permission.</li>
          </ul>
          <p>We may suspend keys, wallets or IP addresses that break these rules, with or without notice.</p>

          <h2>API keys</h2>
          <p>
            Keep your keys secret. You are responsible for all use of keys created by your wallet. If a key
            leaks, revoke it right away.
          </p>

          <h2>AI answers</h2>
          <p>
            Answers are produced by third-party AI models and can be wrong, incomplete or offensive. They are
            not professional, legal, financial or medical advice. Check anything important before you rely on
            it. You are responsible for how you use the answers.
          </p>

          <h2>Free tiers and paid credits</h2>
          <p>
            Free access is {brand.tokenEnabled ? "funded by the treasury and " : ""}limited by hourly and
            daily allowances and a shared daily budget, and can pause until 00:00 UTC when that budget is used
            up. When paid credits launch, prices will be shown before you top up. Credits are non-refundable
            except where the law requires otherwise.
          </p>

          {brand.tokenEnabled && (
            <>
              <h2 id="token">The {tokenTicker} token</h2>
              <p>
                {tokenTicker} is a utility token. Holding it can raise your usage limits on the Service. It is
                not an investment, a share, a loan or a claim on {brand.legalName} or its treasury, and it
                gives no right to profits, dividends or votes unless we say so in writing.
              </p>
              <ul>
                <li>
                  Its price can go down as well as up, including to zero, and there may be no one to sell it
                  to.
                </li>
                <li>
                  The fee split and treasury rules shown on the site are proposals and may change before or
                  after launch.
                </li>
                <li>
                  Smart contracts and blockchains can fail or be attacked, and transactions can&apos;t be
                  reversed.
                </li>
                <li>
                  Token rules differ by country. You are responsible for following yours and for any taxes.
                </li>
              </ul>
              <p>Nothing on the site is financial advice. Don&apos;t buy more than you can afford to lose.</p>
            </>
          )}

          <h2>No warranty</h2>
          <p>
            The Service is provided &quot;as is&quot; and &quot;as available&quot;, without warranties of any
            kind, to the extent the law allows.
          </p>

          <h2>Limitation of liability</h2>
          <p>
            To the extent the law allows, {brand.legalName} is not liable for indirect or consequential
            losses, lost profits, lost data or token losses. Our total liability for any claim is limited to
            the amount you paid us in the 3 months before the claim, or US$50 if you paid nothing.
          </p>

          <h2>Changes and ending</h2>
          <p>
            We may update these terms. The date at the top shows the latest version, and continuing to use the
            Service means you accept it. You can stop using the Service at any time; we may end or suspend
            access if you break these terms.
          </p>

          <h2>Contact</h2>
          <p>
            {contact ? (
              <>
                Questions? Email <a href={`mailto:${contact}`}>{contact}</a>.
              </>
            ) : (
              "Questions? Contact us through the channels listed on the site."
            )}{" "}
            See also the <Link href="/privacy">Privacy Policy</Link>.
          </p>
        </article>
      </div>
    </main>
  );
}
