"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { brand } from "@refract/config";
import { shortAddr } from "@/lib/format";
import { useWallet } from "./WalletProvider";

export function WalletModal() {
  const w = useWallet();
  const ref = useRef<HTMLDialogElement>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (w.modalOpen && !d.open) {
      setMsg("");
      d.showModal();
    }
    if (!w.modalOpen && d.open) d.close();
  }, [w.modalOpen]);

  const used = w.compareUsed;
  const pct = Math.min(100, (used / w.compareLimit) * 100);

  return (
    <dialog
      id="walletModal"
      aria-labelledby="wmTitle"
      ref={ref}
      onClose={w.closeModal}
      onClick={(e) => {
        if (e.target === e.currentTarget) w.closeModal();
      }}
    >
      <div className="m" id="wmBody">
        <button className="mx" aria-label="Close" type="button" onClick={w.closeModal}>
          ×
        </button>
        {!w.addr ? (
          <>
            <h3 id="wmTitle">Connect a wallet</h3>
            <p>
              Your wallet is your account. Connecting only shares your public address. No transaction, no gas.
            </p>
            <div className="opts">
              <button
                className="opt"
                type="button"
                onClick={async () => {
                  setMsg("");
                  const err = await w.connect();
                  if (err) setMsg(err);
                }}
              >
                <span className="ic" />
                <span>
                  Browser wallet<small>MetaMask, Rabby or any injected wallet</small>
                </span>
              </button>
            </div>
            <div className="msg" role="status">
              {msg}
            </div>
          </>
        ) : (
          <>
            <h3 id="wmTitle">Your access</h3>
            <p>Everything below is tied to this wallet.</p>
            <div className="addr">
              <span>{shortAddr(w.addr)}</span>
              <button className="link" type="button" onClick={w.disconnect}>
                Disconnect
              </button>
            </div>
            <div className="usage">
              <span>Free comparisons this hour</span>
              <span>
                <b>{used}</b> of {w.compareLimit}
              </span>
            </div>
            <div className="meter">
              <i style={{ width: `${pct}%` }} />
            </div>
            <div className="krow">
              <strong>API keys</strong>
              <button
                className="btn sm"
                type="button"
                style={{ marginLeft: "auto" }}
                disabled
                title="Self-serve keys open with wallet sign-in"
              >
                Create key
              </button>
            </div>
            <ul className="keys">
              <li style={{ color: "var(--faint)" }}>
                <span>
                  Self-serve keys open with wallet sign-in, coming soon.
                  {brand.contactEmail ? (
                    <>
                      {" "}
                      For early access, email{" "}
                      <a href={`mailto:${brand.contactEmail}`}>{brand.contactEmail}</a>.
                    </>
                  ) : (
                    <>
                      {" "}
                      Meanwhile, the{" "}
                      <Link href="/docs" onClick={w.closeModal}>
                        docs
                      </Link>{" "}
                      show how the API works.
                    </>
                  )}
                </span>
              </li>
            </ul>
          </>
        )}
      </div>
    </dialog>
  );
}
