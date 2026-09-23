"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { KeyInfo, MeResponse } from "@refract/shared";
import { ApiRequestError, apiFetch } from "@/lib/api";
import { publicConfig } from "@/lib/config";
import { store, today } from "@/lib/storage";
import { signInWithWallet, walletConnectProvider, WalletFlowError, type Eip1193 } from "@/lib/wallet";

const HOUR_MS = 3_600_000;

export type ConnectKind = "injected" | "walletconnect";

interface WalletContextValue {
  /** Signed-in account, or null. `undefined` while the session is being checked. */
  me: MeResponse | null | undefined;
  addr: string | null;
  keys: KeyInfo[];
  /** Sign in with a wallet. Resolves to an error message, or null on success. */
  connect(kind: ConnectKind): Promise<string | null>;
  disconnect(): Promise<void>;
  refresh(): Promise<void>;
  /** Create a key; the returned object carries the full key exactly once. */
  createKey(name?: string): Promise<KeyInfo>;
  revokeKey(id: string): Promise<void>;
  modalOpen: boolean;
  openModal(): void;
  closeModal(): void;
  /** Free comparisons used in the last hour, as last reported by the API. */
  compareUsed: number;
  compareLimit: number;
  setCompareRemaining(remaining: number): void;
  /** Record one comparison run for this browser's local history. */
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
  const [me, setMe] = useState<MeResponse | null | undefined>(undefined);
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [compare, setCompare] = useState<{ remaining: number; at: number } | null>(null);
  const [version, setVersion] = useState(0);
  const [wc, setWc] = useState<(Eip1193 & { disconnect(): Promise<void> }) | null>(null);
  const limit = publicConfig.compareLimitPerHour;

  const loadKeys = useCallback(async () => {
    const res = await apiFetch<{ data: KeyInfo[] }>("/me/keys");
    setKeys(res.data);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { me: m } = await apiFetch<{ me: MeResponse | null }>("/auth/session");
      setMe(m);
      if (m) await loadKeys();
      else setKeys([]);
    } catch {
      setMe((prev) => prev ?? null);
    }
  }, [loadKeys]);

  useEffect(() => {
    void refresh();
    const c = store.get<{ remaining: number; at: number } | null>("refract.compare", null);
    if (c && Date.now() - c.at < HOUR_MS) setCompare(c);
  }, [refresh]);

  const connect = useCallback(
    async (kind: ConnectKind): Promise<string | null> => {
      try {
        let provider: Eip1193;
        if (kind === "walletconnect") {
          const p = await walletConnectProvider(publicConfig.siweChainId);
          setWc(p);
          provider = p;
        } else {
          if (!window.ethereum) {
            return "No browser wallet found. On a computer, install MetaMask or Rabby. On a phone, open this page in your wallet app's built-in browser, or use WalletConnect.";
          }
          provider = window.ethereum;
        }
        const m = await signInWithWallet(provider);
        setMe(m);
        await loadKeys();
        return null;
      } catch (e) {
        if (e instanceof WalletFlowError || e instanceof ApiRequestError) return e.message;
        return "Sign-in didn't complete. Try again.";
      }
    },
    [loadKeys],
  );

  const disconnect = useCallback(async () => {
    await apiFetch("/auth/logout", { method: "POST" }).catch(() => undefined);
    await wc?.disconnect().catch(() => undefined);
    setWc(null);
    setMe(null);
    setKeys([]);
  }, [wc]);

  const createKey = useCallback(
    async (name?: string) => {
      const created = await apiFetch<KeyInfo>("/me/keys", { method: "POST", body: name ? { name } : {} });
      await refresh();
      return created;
    },
    [refresh],
  );

  const revokeKey = useCallback(
    async (id: string) => {
      await apiFetch(`/me/keys/${encodeURIComponent(id)}`, { method: "DELETE" });
      await refresh();
    },
    [refresh],
  );

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
      me,
      addr: me?.address ?? null,
      keys,
      connect,
      disconnect,
      refresh,
      createKey,
      revokeKey,
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
    [
      me,
      keys,
      connect,
      disconnect,
      refresh,
      createKey,
      revokeKey,
      modalOpen,
      compare,
      limit,
      setCompareRemaining,
      recordRun,
      version,
    ],
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
