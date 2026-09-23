"use client";

import { useEffect, useRef, useState } from "react";
import { encodeFunctionData, erc20Abi, parseEther, parseUnits, toHex, type Address } from "viem";
import type { CreditsResponse, DepositResponse } from "@refract/shared";
import { ApiRequestError, apiFetch } from "@/lib/api";
import { shortAddr } from "@/lib/format";
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
          setStatus(`Added $${res.usd.toFixed(2)}. Your balance is $${res.balanceUsd.toFixed(2)}.`);
          onCredited();
          return;
        }
        setStatus(`Payment sent. Waiting for confirmations: ${res.confirmations} of ${res.required}…`);
      } catch (e) {
        setError(e instanceof ApiRequestError ? e.message : "Couldn't check the payment. Try again.");
        setStatus("");
        return;
      }
      await sleep(POLL_MS);
    }
    if (!cancelled.current) {
      setStatus("");
      setError("This is taking longer than usual. Paste the transaction hash below later to finish.");
    }
  };

  const payFromWallet = async () => {
    setError("");
    setStatus("");
    const me = w.me;
    const provider = w.provider();
    if (!me) return;
    if (!provider) {
      setError(
        "No wallet connection found. Send the payment manually to the address below, then paste the transaction hash.",
      );
      return;
    }
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter an amount above zero.");
      return;
    }
    setBusy(true);
    try {
      const [from] = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      if (!from || from.toLowerCase() !== me.address.toLowerCase()) {
        setError(
          `Your wallet is on another account. Switch to ${shortAddr(me.address)}: top-ups are credited to the signed-in wallet.`,
        );
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
          setError(`Switch your wallet to ${chain}, then try again.`);
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
      setStatus("Confirm the payment in your wallet…");
      const hash = String(await provider.request({ method: "eth_sendTransaction", params: [tx] }));
      await waitForCredit(hash);
    } catch (e) {
      setStatus("");
      const msg =
        e instanceof Error && /reject|denied|cancel/i.test(e.message)
          ? "Payment was cancelled in your wallet."
          : "The payment didn't go through. Nothing was charged.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const checkManual = async () => {
    setError("");
    if (!/^0x[0-9a-fA-F]{64}$/.test(manualHash.trim())) {
      setError("That doesn't look like a transaction hash (0x followed by 64 characters).");
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
        <button className="mx" aria-label="Close" type="button" onClick={onClose}>
          ×
        </button>
        <h3 id="tuTitle">Top up credits</h3>
        <p>
          Builder requests cost the model price + {Math.round((credits.markup - 1) * 100)}%, with no daily
          cap. Credit is added after {credits.confirmations} confirmation
          {credits.confirmations === 1 ? "" : "s"} on {chain}.
        </p>
        <div className="seg" role="group" aria-label="Pay with" style={{ marginBottom: 14 }}>
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
          <span>{asset === "USDG" ? "Amount (USD)" : "Amount (ETH)"}</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            aria-label="Amount"
          />
        </label>
        <button
          className="btn"
          type="button"
          style={{ width: "100%" }}
          disabled={busy}
          onClick={payFromWallet}
        >
          {busy ? "Working…" : `Pay ${amount || "0"} ${asset} from wallet`}
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
          <div className="t">
            Or send {asset} on {chain} from {w.me ? shortAddr(w.me.address) : "your wallet"} to:
          </div>
          <div className="addr">
            <span className="ca-addr">{credits.depositAddress}</span>
            <button className="link" type="button" style={{ color: "var(--muted)" }} onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="tu-row">
            <input
              placeholder="Paste the transaction hash (0x…)"
              value={manualHash}
              onChange={(e) => setManualHash(e.target.value)}
              aria-label="Transaction hash"
            />
            <button
              className="btn dark sm"
              type="button"
              disabled={busy || !manualHash}
              onClick={checkManual}
            >
              Check
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
