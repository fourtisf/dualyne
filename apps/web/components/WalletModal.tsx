"use client";

import { useEffect, useRef, useState } from "react";
import { brand } from "@dualyne/config";
import type { KeyInfo, MeResponse } from "@dualyne/shared";
import { ApiRequestError } from "@/lib/api";
import { apiErrorText, type Dict } from "@/lib/i18n";
import { shortAddr } from "@/lib/format";
import { isPhone, KNOWN_WALLETS, safeWalletIcon, walletConnectEnabled } from "@/lib/wallet";
import { useT } from "./LocaleProvider";
import { useWallet, type ConnectTarget } from "./WalletProvider";

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

/** The wallet's own icon (from the extension), else our copy of its logo, else a letter tile. */
function WalletIcon({
  name,
  icon,
  rdns,
  color,
}: {
  name: string;
  icon?: string;
  rdns?: string;
  color?: string;
}) {
  const src =
    (icon ? safeWalletIcon(icon) : null) ?? KNOWN_WALLETS.find((k) => k.rdns === rdns)?.logo ?? null;
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- tiny local SVG or inline data URI
    return <img className="ic img" src={src} alt="" width={34} height={34} />;
  }
  return (
    <svg className="ic img" viewBox="0 0 34 34" aria-hidden="true">
      <rect width="34" height="34" rx="9" fill={color ?? "#2A2A33"} />
      <text x="17" y="22.5" textAnchor="middle" fontSize="15" fontWeight="600" fill="#fff">
        {name.charAt(0)}
      </text>
    </svg>
  );
}

export function WalletModal() {
  const w = useWallet();
  const d = useT();
  const t = d.wallet;
  const ref = useRef<HTMLDialogElement>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [env, setEnv] = useState({ phone: false, injected: false, url: "" });
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    if (!w.modalOpen) return;
    setEnv({ phone: isPhone(), injected: Boolean(window.ethereum), url: window.location.href });
  }, [w.modalOpen]);

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

  const connect = async (id: string, target: ConnectTarget) => {
    setMsg("");
    setBusy(id);
    const err = await w.connect(target);
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

  const installed = new Set(w.wallets.map((x) => x.info.rdns));
  // On a phone without a wallet, offer the wallets that can open this page in their own browser.
  const others = KNOWN_WALLETS.filter((k) => !installed.has(k.rdns) && (!env.phone || k.openInApp));

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
              {w.wallets.map((x) => (
                <button
                  key={x.info.uuid || x.info.rdns}
                  className="opt"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => connect(x.info.uuid, { kind: "injected", wallet: x })}
                >
                  <WalletIcon name={x.info.name} icon={x.info.icon} rdns={x.info.rdns} />
                  <span>
                    {busy === x.info.uuid ? t.check : x.info.name}
                    <small>{t.detected}</small>
                  </span>
                </button>
              ))}
              {!w.wallets.length && env.injected && (
                <button
                  className="opt"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => connect("injected", { kind: "injected" })}
                >
                  <span className="ic" />
                  <span>
                    {busy === "injected" ? t.check : t.browser}
                    <small>{t.browserSub}</small>
                  </span>
                </button>
              )}
              {walletConnectEnabled() && (
                <button
                  className="opt"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => connect("walletconnect", { kind: "walletconnect" })}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- tiny local SVG */}
                  <img className="ic img" src="/wallets/walletconnect.svg" alt="" width={34} height={34} />
                  <span>
                    {busy === "walletconnect" ? t.check : t.walletConnect}
                    <small>{t.walletConnectSub}</small>
                  </span>
                </button>
              )}
            </div>
            {!w.wallets.length && !env.injected && <p className="opts-none">{t.noneHere}</p>}
            {others.length > 0 && (
              <>
                <div className="opts-h">{env.phone ? t.openInWallet : t.moreWallets}</div>
                <div className="opts more">
                  {others.map((k) => {
                    const inApp = env.phone && k.openInApp && env.url ? k.openInApp(env.url) : null;
                    return (
                      <a
                        key={k.rdns}
                        className="opt"
                        href={inApp ?? k.install}
                        target={inApp ? undefined : "_blank"}
                        rel="noopener"
                      >
                        <WalletIcon name={k.name} rdns={k.rdns} color={k.color} />
                        <span>
                          {k.name}
                          <small>{inApp ? t.openInApp : t.install}</small>
                        </span>
                      </a>
                    );
                  })}
                </div>
              </>
            )}
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
