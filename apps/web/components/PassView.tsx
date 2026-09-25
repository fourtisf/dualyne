"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { encodeFunctionData, formatEther, parseAbi, toHex, type Address } from "viem";
import { PASS_PALETTES, passSvg, type PassInfo } from "@dualyne/shared";
import { apiFetch } from "@/lib/api";
import { publicConfig } from "@/lib/config";
import { shortAddr } from "@/lib/format";
import { PRO_CHANGED_EVENT } from "./ProDialog";
import { chainName } from "./TopUpDialog";
import { useWallet } from "./WalletProvider";

const MINT_ABI = parseAbi(["function mint(uint256 qty) payable"]);
const RECEIPT_POLL_MS = 3000;
const RECEIPT_WAIT_MS = 5 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const art = (id: number) => `data:image/svg+xml;utf8,${encodeURIComponent(passSvg(id))}`;
/** "0.02" rather than "0.020000000000000000". */
const eth = (wei: bigint) =>
  formatEther(wei)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");

type Step = { kind: "idle" } | { kind: "busy"; text: string } | { kind: "done"; hash: string; pro: boolean };

/** The Dualyne Pass mint page: artwork, the live sale, and minting from the signed-in wallet. */
export function PassView() {
  const w = useWallet();
  const [info, setInfo] = useState<PassInfo | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [qty, setQty] = useState(1);
  const [shown, setShown] = useState(1);
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      // A public route: fetched without cookies (the API answers it with "*" CORS).
      // no-store: right after a mint the numbers must be fresh, not the browser's copy.
      const r = await fetch(`${publicConfig.apiUrl}/pass`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const res = (await r.json()) as PassInfo;
      setInfo(res);
      setLoadError(false);
      if (res.minted != null) setShown((s) => (s === 1 ? res.minted! + 1 : s));
    } catch {
      setLoadError(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const price = info?.priceWei != null ? BigInt(info.priceWei) : null;
  const maxQty = Math.max(1, info?.maxPerWallet ?? 1);
  const soldOut = info?.minted != null && info.maxSupply != null && info.minted >= info.maxSupply;
  const left = info?.minted != null && info.maxSupply != null ? info.maxSupply - info.minted : null;
  const chain = chainName(info?.chainId ?? publicConfig.siweChainId);
  const explorer = publicConfig.explorerUrl;
  const busy = step.kind === "busy";

  async function waitForReceipt(provider: NonNullable<ReturnType<typeof w.provider>>, hash: string) {
    const until = Date.now() + RECEIPT_WAIT_MS;
    while (Date.now() < until) {
      const r = (await provider.request({ method: "eth_getTransactionReceipt", params: [hash] })) as {
        status?: string;
      } | null;
      if (r?.status) return r.status === "0x1";
      await sleep(RECEIPT_POLL_MS);
    }
    return null;
  }

  async function mint() {
    setError("");
    if (!info?.address || price == null) return;
    if (!w.addr) {
      w.openModal();
      return;
    }
    const provider = w.provider();
    if (!provider) {
      setError("Reconnect your wallet (Disconnect, then connect again) so it can send the mint.");
      return;
    }
    try {
      setStep({ kind: "busy", text: "Waiting for your wallet…" });
      const [from] = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      if (!from || from.toLowerCase() !== w.addr.toLowerCase()) {
        setError(`Switch your wallet to ${shortAddr(w.addr)}, the address you signed in with.`);
        setStep({ kind: "idle" });
        return;
      }
      const current = parseInt(String(await provider.request({ method: "eth_chainId" })), 16);
      if (current !== info.chainId) {
        try {
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: toHex(info.chainId) }],
          });
        } catch {
          setError(`Switch your wallet to ${chain} and try again.`);
          setStep({ kind: "idle" });
          return;
        }
      }
      const tx = {
        from,
        to: info.address as Address,
        data: encodeFunctionData({ abi: MINT_ABI, functionName: "mint", args: [BigInt(qty)] }),
        value: toHex(price * BigInt(qty)),
      };
      // Estimate first: a mint that would revert (sold out, wallet limit, not enough ETH) is caught
      // here, before the wallet asks for anything, and every wallet gets enough gas.
      let gas: bigint;
      try {
        gas = BigInt(String(await provider.request({ method: "eth_estimateGas", params: [tx] })));
      } catch {
        setError(
          "This mint would fail: you may have reached the per-wallet limit, it may have just sold out, or the wallet doesn't hold enough ETH for the price and gas.",
        );
        setStep({ kind: "idle" });
        void load();
        return;
      }
      setStep({ kind: "busy", text: "Confirm the mint in your wallet…" });
      const hash = String(
        await provider.request({
          method: "eth_sendTransaction",
          params: [{ ...tx, gas: toHex((gas * 12n) / 10n) }],
        }),
      );
      setStep({ kind: "busy", text: "Minting… this takes a few seconds." });
      const ok = await waitForReceipt(provider, hash);
      if (ok === false) {
        setError("The mint failed on-chain (sold out, or over the per-wallet limit). No Pass was minted.");
        setStep({ kind: "idle" });
        return;
      }
      let pro = false;
      if (ok) {
        pro = await apiFetch<{ pass: boolean }>("/me/pass/refresh", { method: "POST" })
          .then((r) => r.pass)
          .catch(() => false);
        if (pro) window.dispatchEvent(new Event(PRO_CHANGED_EVENT));
      }
      setStep({ kind: "done", hash, pro });
      void load();
    } catch (e) {
      setStep({ kind: "idle" });
      setError(
        e instanceof Error && /reject|denied|cancel/i.test(e.message)
          ? "You cancelled the mint. Nothing was charged."
          : "The mint didn't go through. Check you have enough ETH for the price and gas, then try again.",
      );
    }
  }

  return (
    <main className="view pass-page">
      <div className="wrap">
        <div className="pass-grid">
          <section className="pass-art" aria-label="Pass artwork">
            {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data, nothing to optimise */}
            <img
              src={art(shown)}
              alt={`Dualyne Pass #${String(shown).padStart(4, "0")}`}
              width={600}
              height={600}
            />
            <div className="pass-swatches" role="group" aria-label="Colors">
              {PASS_PALETTES.map((p, i) => {
                // Pass #n is color n mod 6: show the next number with this color.
                const base = info?.minted != null ? info.minted + 1 : 1;
                const id =
                  base + ((i - (base % PASS_PALETTES.length) + PASS_PALETTES.length) % PASS_PALETTES.length);
                return (
                  <button
                    key={p.name}
                    type="button"
                    className={shown % PASS_PALETTES.length === i ? "on" : ""}
                    style={{ background: `linear-gradient(135deg, ${p.a}, ${p.b})` }}
                    onClick={() => setShown(id)}
                    aria-label={p.name}
                    title={p.name}
                  />
                );
              })}
            </div>
            <p className="pass-note">
              Six colors, set by the Pass number. The artwork lives fully on-chain: this is the exact image
              the contract returns.
            </p>
          </section>

          <section className="pass-buy">
            <div className="kick">
              <i />
              Dualyne Pass
            </div>
            <h1 className="grad">Hold a Pass, get Pro.</h1>
            <p className="pass-lede">
              A Dualyne Pass is an NFT membership. While it&apos;s in your wallet, that wallet has Dualyne
              Pro: every model in Chat, including GPT-5, Gemini 2.5 Pro and Claude Sonnet and Opus. No
              subscription, no renewals. Sell or send it and Pro goes with it.
            </p>

            {!info && !loadError && <p className="pass-muted">Loading the sale…</p>}
            {loadError && <p className="pass-err">Couldn&apos;t load the sale. Refresh to try again.</p>}
            {info && !info.enabled && <p className="pass-muted">The Pass launches soon.</p>}

            {info?.enabled && (
              <>
                <dl className="pass-stats">
                  <div>
                    <dt>Price</dt>
                    <dd>{price != null ? `${eth(price)} ETH` : "—"}</dd>
                  </div>
                  <div>
                    <dt>Minted</dt>
                    <dd>
                      {info.minted ?? "—"} / {info.maxSupply ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Chain</dt>
                    <dd>{chain}</dd>
                  </div>
                </dl>
                {info.minted != null && info.maxSupply ? (
                  <div
                    className="pass-bar"
                    role="progressbar"
                    aria-label="Minted"
                    aria-valuemin={0}
                    aria-valuemax={info.maxSupply}
                    aria-valuenow={info.minted}
                  >
                    <span style={{ width: `${Math.min(100, (info.minted / info.maxSupply) * 100)}%` }} />
                  </div>
                ) : null}

                {step.kind === "done" ? (
                  <div className="pass-done" role="status">
                    <strong>Minted. Welcome in.</strong>
                    <p>
                      {step.pro
                        ? "Pro is on for this wallet. Every model is open in Chat."
                        : "Pro turns on within a few minutes, once the network confirms the mint."}
                    </p>
                    <div className="pass-actions">
                      <Link className="btn" href="/chat">
                        Open Chat
                      </Link>
                      {explorer && (
                        <a
                          className="btn dark"
                          href={`${explorer}/tx/${step.hash}`}
                          target="_blank"
                          rel="noopener"
                        >
                          View transaction
                        </a>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="pass-qty">
                      <span id="qtyLabel">Quantity</span>
                      <div className="pass-step" role="group" aria-labelledby="qtyLabel">
                        <button
                          type="button"
                          aria-label="One fewer"
                          disabled={qty <= 1 || busy}
                          onClick={() => setQty((q) => q - 1)}
                        >
                          −
                        </button>
                        <output aria-live="polite">{qty}</output>
                        <button
                          type="button"
                          aria-label="One more"
                          disabled={qty >= maxQty || (left != null && qty >= left) || busy}
                          onClick={() => setQty((q) => q + 1)}
                        >
                          +
                        </button>
                      </div>
                      <span className="pass-muted">Up to {maxQty} per wallet</span>
                    </div>
                    <button
                      type="button"
                      className="btn pass-mint"
                      disabled={busy || !info.mintOpen || soldOut || price == null}
                      onClick={() => void mint()}
                    >
                      {soldOut
                        ? "Sold out"
                        : !info.mintOpen
                          ? "Mint opens soon"
                          : busy
                            ? step.text
                            : w.addr
                              ? `Mint ${qty} for ${price != null ? eth(price * BigInt(qty)) : "—"} ETH`
                              : "Connect wallet to mint"}
                    </button>
                    {error && (
                      <p className="pass-err" role="alert">
                        {error}
                      </p>
                    )}
                    {w.addr && (
                      <p className="pass-muted">
                        Minting to {shortAddr(w.addr)}. Pro unlocks on this account as soon as the Pass lands.
                      </p>
                    )}
                  </>
                )}
              </>
            )}

            <h2>What a Pass gives you</h2>
            <ul className="pass-list">
              <li>Every model in Chat, premium ones included</li>
              <li>
                {publicConfig.proChatPerDay} messages a day, {publicConfig.proPremiumPerDay} of them on
                premium models
              </li>
              <li>{publicConfig.webProPerDay} web searches a day</li>
              <li>Pro for as long as you hold it. Nothing renews, nothing to cancel</li>
            </ul>

            <h2>Good to know</h2>
            <ul className="pass-list plain">
              <li>
                Sign in with the wallet that holds the Pass. We check the wallet every few minutes, so a Pass
                you sell or send stops giving Pro shortly after.
              </li>
              <li>
                The Pass is a membership, not an investment. We make no promise about its price or resale
                value.
              </li>
              {info?.address && (
                <li>
                  Contract:{" "}
                  {explorer ? (
                    <a href={`${explorer}/address/${info.address}`} target="_blank" rel="noopener">
                      <code>{info.address}</code>
                    </a>
                  ) : (
                    <code>{info.address}</code>
                  )}
                </li>
              )}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
