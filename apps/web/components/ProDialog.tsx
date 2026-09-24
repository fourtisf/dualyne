"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { encodeFunctionData, erc20Abi, parseEther, parseUnits, toHex, type Address } from "viem";
import type { ProPaymentResponse, ProResponse } from "@dualyne/shared";
import { ApiRequestError, apiFetch } from "@/lib/api";
import { shortAddr } from "@/lib/format";
import { apiErrorText } from "@/lib/i18n";
import { useT } from "./LocaleProvider";
import { chainName } from "./TopUpDialog";
import { useWallet } from "./WalletProvider";

const OPEN_EVENT = "dualyne:open-pro";
/** Fired after a payment activates or extends Pro, so the chat can re-read its quota. */
export const PRO_CHANGED_EVENT = "dualyne:pro-changed";

/** Open the Pro dialog from anywhere on the site. */
export const openPro = () => window.dispatchEvent(new Event(OPEN_EVENT));

const PERIODS = [1, 3, 6];
const POLL_MS = 6000;
const POLL_FOR_MS = 20 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

/** ETH for a USD amount, with 1% on top for price movement, rounded up to 6 decimals. */
const ethFor = (usd: number, ethUsd: number) => (Math.ceil((usd / ethUsd) * 1.01 * 1e6) / 1e6).toString();

/** Buy or extend Pro with a stablecoin or ETH, verified on-chain by transaction hash. */
export function ProDialog() {
  const w = useWallet();
  const d = useT();
  const t = d.pro;
  const tu = d.topup;
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<ProResponse | null>(null);
  const [asset, setAsset] = useState("");
  const [periods, setPeriods] = useState(1);
  const [manualHash, setManualHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const cancelled = useRef(false);
  /** Reopen after the wallet modal signs someone in. */
  const resume = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<ProResponse>("/me/pro");
      setInfo(res);
      setAsset((a) => a || res.tokens[0]?.symbol || (res.ethUsd ? "ETH" : ""));
    } catch (e) {
      setError(e instanceof ApiRequestError ? apiErrorText(d, e.code, e.message) : tu.errors.check);
    }
  }, [d, tu]);

  useEffect(() => {
    const onOpen = () => {
      setStatus("");
      setError("");
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (resume.current && w.me) {
      resume.current = false;
      setOpen(true);
    }
  }, [w.me]);

  useEffect(() => {
    if (open && w.me) void load();
  }, [open, w.me, load]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      cancelled.current = false;
      el.showModal();
    }
    if (!open && el.open) el.close();
    if (!open) cancelled.current = true;
  }, [open]);

  const close = () => setOpen(false);

  const token = info?.tokens.find((x) => x.symbol === asset);
  const usd = (info?.priceUsd ?? 0) * periods;
  const amount = asset === "ETH" ? (info?.ethUsd ? ethFor(usd, info.ethUsd) : "") : String(usd);
  const chain = info ? chainName(info.chainId) : "";

  const waitForPro = async (txHash: string) => {
    const until = Date.now() + POLL_FOR_MS;
    while (!cancelled.current && Date.now() < until) {
      try {
        const res = await apiFetch<ProPaymentResponse>("/me/pro/payments", {
          method: "POST",
          body: { txHash },
        });
        if (res.status === "active") {
          setStatus(t.done(fmtDate(res.proUntil)));
          window.dispatchEvent(new Event(PRO_CHANGED_EVENT));
          await load();
          return;
        }
        setStatus(t.waiting(res.confirmations, res.required));
      } catch (e) {
        setError(e instanceof ApiRequestError ? apiErrorText(d, e.code, e.message) : tu.errors.check);
        setStatus("");
        return;
      }
      await sleep(POLL_MS);
    }
    if (!cancelled.current) {
      setStatus("");
      setError(tu.errors.slow);
    }
  };

  const payFromWallet = async () => {
    setError("");
    setStatus("");
    const me = w.me;
    const provider = w.provider();
    if (!me || !info?.payTo || !amount) return;
    if (!provider) {
      setError(tu.errors.noProvider);
      return;
    }
    setBusy(true);
    try {
      const [from] = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      if (!from || from.toLowerCase() !== me.address.toLowerCase()) {
        setError(tu.errors.account(shortAddr(me.address)));
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
          setError(tu.errors.chain(chain));
          return;
        }
      }
      const payTo = info.payTo as Address;
      let tx: Record<string, string>;
      if (asset === "ETH") {
        tx = { from, to: payTo, value: toHex(parseEther(amount)) };
      } else {
        if (!token || token.decimals == null) {
          setError(tu.errors.noProvider);
          return;
        }
        tx = {
          from,
          to: token.address,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [payTo, parseUnits(amount, token.decimals)],
          }),
        };
      }
      setStatus(t.confirm);
      const hash = String(await provider.request({ method: "eth_sendTransaction", params: [tx] }));
      await waitForPro(hash);
    } catch (e) {
      setStatus("");
      setError(
        e instanceof Error && /reject|denied|cancel/i.test(e.message)
          ? tu.errors.cancelled
          : tu.errors.failed,
      );
    } finally {
      setBusy(false);
    }
  };

  const checkManual = async () => {
    setError("");
    if (!/^0x[0-9a-fA-F]{64}$/.test(manualHash.trim())) {
      setError(tu.errors.hash);
      return;
    }
    setBusy(true);
    await waitForPro(manualHash.trim());
    setBusy(false);
  };

  const copy = async () => {
    if (!info?.payTo) return;
    try {
      await navigator.clipboard.writeText(info.payTo);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* select by hand */
    }
  };

  const perks = t.perks(info?.chatPerDay ?? 0, info?.premiumPerDay ?? 0);
  const options = [...(info?.tokens.map((x) => x.symbol) ?? []), ...(info?.ethUsd ? ["ETH"] : [])];

  return (
    <dialog
      ref={ref}
      aria-labelledby="proTitle"
      onClose={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="m">
        <button className="mx" aria-label={d.wallet.close} type="button" onClick={close}>
          ×
        </button>
        <h3 id="proTitle">
          {t.title} <span className="pro-pill">PRO</span>
        </h3>

        {!w.me ? (
          <>
            <p>{t.signIn}</p>
            <button
              className="btn"
              type="button"
              style={{ width: "100%" }}
              onClick={() => {
                resume.current = true;
                close();
                w.openModal();
              }}
            >
              {t.connect}
            </button>
          </>
        ) : !info ? (
          error ? (
            <div className="msg" role="alert">
              {error}
            </div>
          ) : (
            <p>{t.working}</p>
          )
        ) : (
          <>
            <p>{t.intro(info.priceUsd, info.days)}</p>
            <ul className="pro-perks">
              {perks.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            {info.active && info.proUntil && (
              <p className="pro-active">{t.activeUntil(fmtDate(info.proUntil))}</p>
            )}

            {!info.open || options.length === 0 ? (
              <p className="pro-closed">{t.closed}</p>
            ) : (
              <>
                <div className="pro-row">
                  <span>{t.period}</span>
                  <div className="seg" role="group" aria-label={t.period}>
                    {PERIODS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        aria-pressed={periods === n}
                        onClick={() => setPeriods(n)}
                      >
                        {t.months(n, info.days)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="pro-row">
                  <span>{t.payWith}</span>
                  <div className="seg" role="group" aria-label={t.payWith}>
                    {options.map((s) => (
                      <button key={s} type="button" aria-pressed={asset === s} onClick={() => setAsset(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="pro-total">
                  <span>{t.total}</span>
                  <b>
                    {amount} {asset}
                  </b>
                </div>
                {asset === "ETH" && <p className="pro-note">{t.ethNote}</p>}
                <button
                  className="btn"
                  type="button"
                  style={{ width: "100%" }}
                  disabled={busy || !amount}
                  onClick={payFromWallet}
                >
                  {busy ? t.working : t.pay(amount, asset)}
                </button>
                {status && (
                  <div className="tu-status" role="status">
                    {status}
                  </div>
                )}
                {error && (
                  <div className="msg" role="alert">
                    {error}
                  </div>
                )}
                <div className="tu-manual">
                  <div className="t">{t.manual(amount, asset, chain, shortAddr(w.me.address))}</div>
                  <div className="addr">
                    <span className="ca-addr">{info.payTo}</span>
                    <button className="link" type="button" style={{ color: "var(--muted)" }} onClick={copy}>
                      {copied ? d.copy.copied : d.copy.copy}
                    </button>
                  </div>
                  <div className="tu-row">
                    <input
                      placeholder={tu.hashPlaceholder}
                      value={manualHash}
                      onChange={(e) => setManualHash(e.target.value)}
                      aria-label={tu.hashLabel}
                    />
                    <button
                      className="btn dark sm"
                      type="button"
                      disabled={busy || !manualHash}
                      onClick={checkManual}
                    >
                      {tu.check}
                    </button>
                  </div>
                </div>
              </>
            )}
            <p className="pro-note">
              {t.fine}{" "}
              <Link href="/terms#pro" onClick={close}>
                {t.terms}
              </Link>
            </p>
          </>
        )}
      </div>
    </dialog>
  );
}

/** A button that opens the Pro dialog. */
export function UpgradeButton({ className, children }: { className: string; children: ReactNode }) {
  return (
    <button className={className} type="button" onClick={openPro}>
      {children}
    </button>
  );
}
