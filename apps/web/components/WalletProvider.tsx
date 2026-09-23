"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { publicConfig } from "@/lib/config";
import { store, today } from "@/lib/storage";

interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}
declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

const HOUR_MS = 3_600_000;

interface WalletContextValue {
  /** Connected address, or null. Read-only until wallet sign-in (SIWE) ships. */
  addr: string | null;
  connect(): Promise<string | null>;
  disconnect(): void;
  modalOpen: boolean;
  openModal(): void;
  closeModal(): void;
  /** Free comparisons used in the last hour, as last reported by the API. */
  compareUsed: number;
  compareLimit: number;
  setCompareRemaining(remaining: number): void;
  /** Record one comparison run for this browser's 7-day history. */
  recordRun(): void;
  /** Bumps whenever local history or votes change, so views re-read storage. */
  version: number;
  bump(): void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [addr, setAddr] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [compare, setCompare] = useState<{ remaining: number; at: number } | null>(null);
  const [version, setVersion] = useState(0);
  const limit = publicConfig.compareLimitPerHour;

  useEffect(() => {
    const w = store.get<{ addr?: string | null; demo?: boolean }>("refract.wallet", {});
    if (w.addr && !w.demo && /^0x[0-9a-fA-F]{40}$/.test(w.addr)) setAddr(w.addr);
    const c = store.get<{ remaining: number; at: number } | null>("refract.compare", null);
    if (c && Date.now() - c.at < HOUR_MS) setCompare(c);
  }, []);

  const connect = useCallback(async (): Promise<string | null> => {
    if (!window.ethereum) {
      return "No browser wallet found. On a computer, install MetaMask or Rabby. On a phone, open this page in your wallet app's built-in browser.";
    }
    try {
      const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
      const a = accounts?.[0];
      if (!a) return "Your wallet didn't share an address. Try again.";
      store.set("refract.wallet", { addr: a });
      setAddr(a);
      return null;
    } catch {
      return "Connection was cancelled in your wallet. Connect again when you're ready.";
    }
  }, []);

  const disconnect = useCallback(() => {
    store.set("refract.wallet", { addr: null });
    setAddr(null);
  }, []);

  const setCompareRemaining = useCallback((remaining: number) => {
    const c = { remaining, at: Date.now() };
    store.set("refract.compare", c);
    setCompare(c);
  }, []);

  const recordRun = useCallback(() => {
    const h = store.get<Record<string, number>>("refract.hist", {});
    h[today()] = (h[today()] ?? 0) + 1;
    store.set("refract.hist", h);
    setVersion((v) => v + 1);
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      addr,
      connect,
      disconnect,
      modalOpen,
      openModal: () => setModalOpen(true),
      closeModal: () => setModalOpen(false),
      compareUsed: compare && Date.now() - compare.at < HOUR_MS ? Math.max(0, limit - compare.remaining) : 0,
      compareLimit: limit,
      setCompareRemaining,
      recordRun,
      version,
      bump: () => setVersion((v) => v + 1),
    }),
    [addr, connect, disconnect, modalOpen, compare, limit, setCompareRemaining, recordRun, version],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

/** Any "Connect wallet" / "Get an API key" style button from the prototype (data-open-wallet). */
export function OpenWalletButton({ className, children }: { className: string; children: ReactNode }) {
  const { openModal } = useWallet();
  return (
    <button className={className} type="button" onClick={openModal}>
      {children}
    </button>
  );
}
