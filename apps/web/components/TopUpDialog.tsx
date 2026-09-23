"use client";

import { useEffect, useRef, useState } from "react";
import { encodeFunctionData, erc20Abi, parseEther, parseUnits, toHex, type Address } from "viem";
import type { CreditsResponse, DepositResponse } from "@dualyne/shared";
import { ApiRequestError, apiFetch } from "@/lib/api";
import { shortAddr } from "@/lib/format";
import { apiErrorText } from "@/lib/i18n";
import { useT } from "./LocaleProvider";
import { useWallet } from "./WalletProvider";

type Enabled = Extract<CreditsResponse, { enabled: true }>;

const CHAINS: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  137: "Polygon",
  8453: "Base",
  42161: "Arbitrum",
  11155111: "Sepolia",
  84532: "Base Sepolia",
};
export const chainName = (id: number) => CHAINS[id] ?? `chain ${id}`;

const POLL_MS = 6000;
const POLL_FOR_MS = 20 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function TopUpDialog({
  open,
  credits,
  onClose,
  onCredited,
}: {
  open: boolean;
  credits: Enabled;
  onClose(): void;
  onCredited(): void;
}) {
  const w = useWallet();
  const d = useT();
  const t = d.topup;
  const ref = useRef<HTMLDialogElement>(null);
  const [asset, setAsset] = useState<"USDG" | "ETH">(credits.usdgAddress ? "USDG" : "ETH");
  const [amount, setAmount] = useState(credits.usdgAddress ? "25" : "0.01");
  const [manualHash, setManualHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setStatus("");
      setError("");
      cancelled.current = false;
      d.showModal();
    }
    if (!open && d.open) d.close();
    if (!open) cancelled.current = true;
  }, [open]);

  const chain = chainName(credits.chainId);

  const waitForCredit = async (txHash: string) => {
    const until = Date.now() + POLL_FOR_MS;
    while (!cancelled.current && Date.now() < until) {
      try {
        const res = await apiFetch<DepositResponse>("/me/credits/deposits", {
          method: "POST",
          body: { txHash },
        });
        if (res.status === "credited") {
          setStatus(t.added(res.usd.toFixed(2), res.balanceUsd.toFixed(2)));
          onCredited();
          return;
        }
        setStatus(t.waiting(res.confirmations, res.required));
      } catch (e) {
        setError(e instanceof ApiRequestError ? apiErrorText(d, e.code, e.message) : t.errors.check);
        setStatus("");
        return;
      }
      await sleep(POLL_MS);
    }
    if (!cancelled.current) {
      setStatus("");
      setError(t.errors.slow);
    }
  };

  const payFromWallet = async () => {
    setError("");
    setStatus("");
    const me = w.me;
    const provider = w.provider();
    if (!me) return;
    if (!provider) {
      setError(t.errors.noProvider);
      return;
    }
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError(t.errors.amount);
      return;
    }
    setBusy(true);
    try {
      const [from] = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      if (!from || from.toLowerCase() !== me.address.toLowerCase()) {
        setError(t.errors.account(shortAddr(me.address)));
        return;
      }
      const current = parseInt(String(await provider.request({ method: "eth_chainId" })), 16);
      if (current !== credits.chainId) {
        try {
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: toHex(credits.chainId) }],
          });
        } catch {
          setError(t.errors.chain(chain));
          return;
        }
      }
      const deposit = credits.depositAddress as Address;
      const tx =
        asset === "USDG"
          ? {
              from,
              to: credits.usdgAddress,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: "transfer",
                args: [deposit, parseUnits(amount, credits.usdgDecimals ?? 18)],
              }),
            }
          : { from, to: deposit, value: toHex(parseEther(amount)) };
      setStatus(t.confirm);
      const hash = String(await provider.request({ method: "eth_sendTransaction", params: [tx] }));
      await waitForCredit(hash);
    } catch (e) {
      setStatus("");
      const msg =
        e instanceof Error && /reject|denied|cancel/i.test(e.message) ? t.errors.cancelled : t.errors.failed;
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const checkManual = async () => {
    setError("");
    if (!/^0x[0-9a-fA-F]{64}$/.test(manualHash.trim())) {
      setError(t.errors.hash);
      return;
    }
    setBusy(true);
    await waitForCredit(manualHash.trim());
    setBusy(false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(credits.depositAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* select by hand */
    }
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="tuTitle"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="m">
        <button className="mx" aria-label={d.wallet.close} type="button" onClick={onClose}>
          ×
        </button>
        <h3 id="tuTitle">{t.title}</h3>
        <p>{t.intro(Math.round((credits.markup - 1) * 100), credits.confirmations, chain)}</p>
        <div className="seg" role="group" aria-label={t.payWith} style={{ marginBottom: 14 }}>
          {credits.usdgAddress && (
            <button
              type="button"
              aria-pressed={asset === "USDG"}
              onClick={() => {
                setAsset("USDG");
                setAmount("25");
              }}
            >
              USDG
            </button>
          )}
          {credits.ethEnabled && (
            <button
              type="button"
              aria-pressed={asset === "ETH"}
              onClick={() => {
                setAsset("ETH");
                setAmount("0.01");
              }}
            >
              ETH
            </button>
          )}
        </div>
        <label className="amt">
          <span>{asset === "USDG" ? t.amountUsd : t.amountEth}</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            aria-label={t.amount}
          />
        </label>
        <button
          className="btn"
          type="button"
          style={{ width: "100%" }}
          disabled={busy}
          onClick={payFromWallet}
        >
          {busy ? t.working : t.pay(amount || "0", asset)}
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
          <div className="t">{t.manual(asset, chain, w.me ? shortAddr(w.me.address) : t.yourWallet)}</div>
          <div className="addr">
            <span className="ca-addr">{credits.depositAddress}</span>
            <button className="link" type="button" style={{ color: "var(--muted)" }} onClick={copy}>
              {copied ? d.copy.copied : d.copy.copy}
            </button>
          </div>
          <div className="tu-row">
            <input
              placeholder={t.hashPlaceholder}
              value={manualHash}
              onChange={(e) => setManualHash(e.target.value)}
              aria-label={t.hashLabel}
            />
            <button
              className="btn dark sm"
              type="button"
              disabled={busy || !manualHash}
              onClick={checkManual}
            >
              {t.check}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
