"use client";

import { useEffect, useRef, useState } from "react";
import { brand } from "@dualyne/config";
import type { KeyInfo, MeResponse } from "@dualyne/shared";
import { ApiRequestError } from "@/lib/api";
import { apiErrorText, type Dict } from "@/lib/i18n";
import { shortAddr } from "@/lib/format";
import { walletConnectEnabled } from "@/lib/wallet";
import { useT } from "./LocaleProvider";
import { useWallet, type ConnectKind } from "./WalletProvider";

const keyLabel = (k: KeyInfo) => `${brand.keyPrefix}…${k.last4}`;
const made = (iso: string) => new Date(iso).toLocaleDateString();

/** Why a wallet can't get a free key, in the page's language. */
export function eligibilityText(t: Dict, e: NonNullable<MeResponse["eligibility"]>): string {
  const tr = t.wallet.eligibility;
  if (!tr) return e.reason;
  if (e.code === "requirement" && e.requirement) {
    return tr.requirement(e.requirement.minEth, e.requirement.minAgeDays);
  }
  return e.code === "check_failed" ? tr.checkFailed : e.reason;
}

export function WalletModal() {
  const w = useWallet();
  const d = useT();
  const t = d.wallet;
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
      setMsg(e instanceof ApiRequestError ? apiErrorText(d, e.code, e.message) : t.createFailed);
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
      setMsg(e instanceof ApiRequestError ? apiErrorText(d, e.code, e.message) : t.revokeFailed);
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
  const notEligible = me?.eligibility && !me.eligibility.eligible ? eligibilityText(d, me.eligibility) : null;
  const createTitle = notEligible
    ? notEligible
    : atMax
      ? me?.tier === "explorer"
        ? t.explorerOneKey
        : t.tierKeys(me?.tierLabel ?? "", me?.keys.max ?? null)
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
        <button className="mx" aria-label={t.close} type="button" onClick={w.closeModal}>
          ×
        </button>
        {!me ? (
          <>
            <h3 id="wmTitle">{t.connectTitle}</h3>
            <p>{t.connectText}</p>
            <div className="opts">
              <button
                className="opt"
                type="button"
                disabled={busy !== null}
                onClick={() => connect("injected")}
              >
                <span className="ic" />
                <span>
                  {busy === "injected" ? t.check : t.browser}
                  <small>{t.browserSub}</small>
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
                    {busy === "walletconnect" ? t.check : t.walletConnect}
                    <small>{t.walletConnectSub}</small>
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
            <h3 id="wmTitle">{t.accessTitle}</h3>
            <p>
              {t.accessText} <b className="tier-name">{me.tierLabel}</b>
            </p>
            <div className="addr">
              <span>{shortAddr(me.address)}</span>
              <button className="link" type="button" onClick={() => void w.disconnect()}>
                {t.disconnect}
              </button>
            </div>
            <div className="usage">
              <span>{t.requestsToday}</span>
              <span>
                {limit === null ? (
                  <b>{t.noCap}</b>
                ) : (
                  <>
                    <b>{used}</b> {t.of} {limit}
                  </>
                )}
              </span>
            </div>
            <div className="meter">
              <i style={{ width: `${limit ? Math.min(100, (used / limit) * 100) : 0}%` }} />
            </div>
            <div className="krow">
              <strong>{t.keys}</strong>
              <button
                className="btn sm"
                id="newKey"
                type="button"
                style={{ marginLeft: "auto" }}
                disabled={atMax || Boolean(notEligible) || busy === "key"}
                title={createTitle}
                onClick={createKey}
              >
                {busy === "key" ? t.creating : t.createKey}
              </button>
            </div>
            {notEligible && <div className="msg">{notEligible}</div>}
            {fresh && (
              <div className="fresh">
                <div className="t">{t.fresh}</div>
                <code>{fresh}</code>
                <button className="btn dark sm" id="copyKey" type="button" onClick={copyKey}>
                  {copied ? d.copy.copied : t.copyKey}
                </button>
              </div>
            )}
            <ul className="keys">
              {w.keys.length ? (
                w.keys.map((k) => (
                  <li key={k.id}>
                    <code>{keyLabel(k)}</code>
                    <span className="when">
                      {k.name ? `${k.name} · ` : ""}
                      {t.created(made(k.createdAt))}
                    </span>
                    <button className="link" type="button" onClick={() => revoke(k.id)}>
                      {confirming === k.id ? t.confirmRevoke : t.revoke}
                    </button>
                  </li>
                ))
              ) : (
                <li style={{ color: "var(--faint)" }}>
                  <span>{t.noKeys}</span>
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
