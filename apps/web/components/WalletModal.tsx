"use client";

import { useEffect, useRef, useState } from "react";
import { brand } from "@refract/config";
import type { KeyInfo } from "@refract/shared";
import { ApiRequestError } from "@/lib/api";
import { shortAddr } from "@/lib/format";
import { walletConnectEnabled } from "@/lib/wallet";
import { useWallet, type ConnectKind } from "./WalletProvider";

const keyLabel = (k: KeyInfo) => `${brand.keyPrefix}…${k.last4}`;
const made = (iso: string) => new Date(iso).toLocaleDateString();

export function WalletModal() {
  const w = useWallet();
  const ref = useRef<HTMLDialogElement>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<ConnectKind | "key" | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (w.modalOpen && !d.open) {
      setMsg("");
      d.showModal();
    }
    if (!w.modalOpen && d.open) d.close();
    if (!w.modalOpen) {
      setFresh(null);
      setConfirming(null);
    }
  }, [w.modalOpen]);

  const connect = async (kind: ConnectKind) => {
    setMsg("");
    setBusy(kind);
    const err = await w.connect(kind);
    setBusy(null);
    if (err) setMsg(err);
  };

  const createKey = async () => {
    setMsg("");
    setBusy("key");
    try {
      const k = await w.createKey();
      setFresh(k.key ?? null);
      setCopied(false);
    } catch (e) {
      setMsg(e instanceof ApiRequestError ? e.message : "Couldn't create a key. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (id: string) => {
    if (confirming !== id) {
      setConfirming(id);
      setTimeout(() => setConfirming((c) => (c === id ? null : c)), 4000);
      return;
    }
    setConfirming(null);
    setFresh(null);
    try {
      await w.revokeKey(id);
    } catch (e) {
      setMsg(e instanceof ApiRequestError ? e.message : "Couldn't revoke the key. Try again.");
    }
  };

  const copyKey = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh);
      setCopied(true);
    } catch {
      /* the key stays visible to select by hand */
    }
  };

  const me = w.me;
  const limit = me?.limits.dailyRequests ?? null;
  const used = me?.usage.today ?? 0;
  const atMax = me ? me.keys.max !== null && me.keys.count >= me.keys.max : false;
  const notEligible = me?.eligibility && !me.eligibility.eligible ? me.eligibility.reason : null;
  const createTitle = notEligible
    ? notEligible
    : atMax
      ? me?.tier === "explorer"
        ? "Explorer wallets get one key. Hold the token for five."
        : `${me?.tierLabel} wallets can have ${me?.keys.max} keys.`
      : undefined;

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
        {!me ? (
          <>
            <h3 id="wmTitle">Connect a wallet</h3>
            <p>
              Your wallet is your account. You&apos;ll sign one message to prove it&apos;s yours. No
              transaction, no gas.
            </p>
            <div className="opts">
              <button
                className="opt"
                type="button"
                disabled={busy !== null}
                onClick={() => connect("injected")}
              >
                <span className="ic" />
                <span>
                  {busy === "injected" ? "Check your wallet…" : "Browser wallet"}
                  <small>MetaMask, Rabby or any injected wallet</small>
                </span>
              </button>
              {walletConnectEnabled() && (
                <button
                  className="opt"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => connect("walletconnect")}
                >
                  <span className="ic alt" />
                  <span>
                    {busy === "walletconnect" ? "Check your wallet…" : "WalletConnect"}
                    <small>Scan with a wallet app on your phone</small>
                  </span>
                </button>
              )}
            </div>
            <div className="msg" role="status">
              {msg}
            </div>
          </>
        ) : (
          <>
            <h3 id="wmTitle">Your access</h3>
            <p>
              Everything below is tied to this wallet. Tier: <b className="tier-name">{me.tierLabel}</b>
            </p>
            <div className="addr">
              <span>{shortAddr(me.address)}</span>
              <button className="link" type="button" onClick={() => void w.disconnect()}>
                Disconnect
              </button>
            </div>
            <div className="usage">
              <span>API requests today</span>
              <span>
                {limit === null ? (
                  <b>No daily cap</b>
                ) : (
                  <>
                    <b>{used}</b> of {limit}
                  </>
                )}
              </span>
            </div>
            <div className="meter">
              <i style={{ width: `${limit ? Math.min(100, (used / limit) * 100) : 0}%` }} />
            </div>
            <div className="krow">
              <strong>API keys</strong>
              <button
                className="btn sm"
                id="newKey"
                type="button"
                style={{ marginLeft: "auto" }}
                disabled={atMax || Boolean(notEligible) || busy === "key"}
                title={createTitle}
                onClick={createKey}
              >
                {busy === "key" ? "Creating…" : "Create key"}
              </button>
            </div>
            {notEligible && <div className="msg">{notEligible}</div>}
            {fresh && (
              <div className="fresh">
                <div className="t">Copy this key now. You won&apos;t see it again.</div>
                <code>{fresh}</code>
                <button className="btn dark sm" id="copyKey" type="button" onClick={copyKey}>
                  {copied ? "Copied" : "Copy key"}
                </button>
              </div>
            )}
            <ul className="keys">
              {w.keys.length ? (
                w.keys.map((k) => (
                  <li key={k.id}>
                    <code>{keyLabel(k)}</code>
                    <span className="when">
                      {k.name ? `${k.name} · ` : ""}Created {made(k.createdAt)}
                    </span>
                    <button className="link" type="button" onClick={() => revoke(k.id)}>
                      {confirming === k.id ? "Confirm revoke" : "Revoke"}
                    </button>
                  </li>
                ))
              ) : (
                <li style={{ color: "var(--faint)" }}>
                  <span>No keys yet. Create one to use {brand.name} from your own apps.</span>
                </li>
              )}
            </ul>
            {msg && (
              <div className="msg" role="status">
                {msg}
              </div>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
