import { getAddress, stringToHex } from "viem";
import { createSiweMessage } from "viem/siwe";
import { brand } from "@dualyne/config";
import type { MeResponse } from "@dualyne/shared";
import { apiFetch } from "./api";
import { publicConfig } from "./config";

/** Minimal EIP-1193 provider (MetaMask, Rabby, WalletConnect…). */
export interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

/** A sign-in step the user can fix; `code` picks the message in the page's language. */
export class WalletFlowError extends Error {
  constructor(
    public readonly code: "cancelled" | "noAddress" | "signCancelled",
    message: string,
  ) {
    super(message);
  }
}

/** Sign-In With Ethereum: one signature, no transaction, no gas. */
export async function signInWithWallet(provider: Eip1193): Promise<MeResponse> {
  let accounts: string[];
  try {
    accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  } catch {
    throw new WalletFlowError(
      "cancelled",
      "Connection was cancelled in your wallet. Connect again when you're ready.",
    );
  }
  const raw = accounts?.[0];
  if (!raw) throw new WalletFlowError("noAddress", "Your wallet didn't share an address. Try again.");
  const address = getAddress(raw);

  const { nonce, chainId } = await apiFetch<{ nonce: string; chainId: number }>("/auth/nonce");
  const now = new Date();
  const message = createSiweMessage({
    domain: window.location.host,
    address,
    statement: `Sign in to ${brand.name}. This proves you own this wallet. No transaction, no gas.`,
    uri: window.location.origin,
    version: "1",
    chainId,
    nonce,
    issuedAt: now,
    expirationTime: new Date(now.getTime() + 10 * 60_000),
  });

  let signature: string;
  try {
    signature = (await provider.request({
      method: "personal_sign",
      params: [stringToHex(message), address],
    })) as string;
  } catch {
    throw new WalletFlowError(
      "signCancelled",
      "Signing was cancelled in your wallet. Connect again when you're ready.",
    );
  }
  return apiFetch<MeResponse>("/auth/verify", { method: "POST", body: { message, signature } });
}

/** A browser wallet announced through EIP-6963 (one entry per installed extension). */
export interface DiscoveredWallet {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193;
}

/**
 * Listens for EIP-6963 announcements, so every installed wallet (MetaMask, Rabby, Phantom,
 * Coinbase, OKX…) is listed on its own instead of whichever one took over window.ethereum.
 * Returns the unsubscribe function.
 */
export function discoverWallets(onChange: (wallets: DiscoveredWallet[]) => void): () => void {
  const found = new Map<string, DiscoveredWallet>();
  const onAnnounce = (e: Event) => {
    const d = (e as CustomEvent<DiscoveredWallet>).detail;
    if (!d?.info?.name || typeof d.provider?.request !== "function") return;
    const key = d.info.rdns || d.info.uuid || d.info.name;
    if (found.has(key)) return;
    found.set(key, d);
    onChange([...found.values()]);
  };
  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
}

/** Wallet icons must be inline images (the standard requires a data URI); anything else is dropped. */
export const safeWalletIcon = (icon: string): string | null =>
  /^data:image\/(svg\+xml|png|jpeg|webp|gif)[;,]/i.test(icon) ? icon : null;

/** Popular wallets offered when not installed: an install page, and on phones a link that opens this site in the wallet's own browser. */
export const KNOWN_WALLETS: {
  rdns: string;
  name: string;
  color: string;
  install: string;
  openInApp?: (url: string) => string;
}[] = [
  {
    rdns: "io.metamask",
    name: "MetaMask",
    color: "#F6851B",
    install: "https://metamask.io/download/",
    openInApp: (url) => `https://metamask.app.link/dapp/${url.replace(/^https?:\/\//, "")}`,
  },
  {
    rdns: "com.trustwallet.app",
    name: "Trust Wallet",
    color: "#0500FF",
    install: "https://trustwallet.com/download",
    openInApp: (url) => `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(url)}`,
  },
  {
    rdns: "com.coinbase.wallet",
    name: "Coinbase Wallet",
    color: "#0052FF",
    install: "https://www.coinbase.com/wallet/downloads",
    openInApp: (url) => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}`,
  },
  {
    rdns: "com.okex.wallet",
    name: "OKX Wallet",
    color: "#2B2B2B",
    install: "https://www.okx.com/web3",
    openInApp: (url) => `okx://wallet/dapp/url?dappUrl=${encodeURIComponent(url)}`,
  },
  {
    rdns: "app.phantom",
    name: "Phantom",
    color: "#AB9FF2",
    install: "https://phantom.com/download",
    openInApp: (url) =>
      `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(new URL(url).origin)}`,
  },
  { rdns: "io.rabby", name: "Rabby", color: "#7084FF", install: "https://rabby.io/" },
];

export const isPhone = (): boolean =>
  typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

export const walletConnectEnabled = (): boolean => Boolean(publicConfig.walletConnectProjectId);

/** Opens the WalletConnect QR / deep-link modal (loaded only when used). */
export async function walletConnectProvider(
  chainId: number,
): Promise<Eip1193 & { disconnect(): Promise<void> }> {
  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  const provider = await EthereumProvider.init({
    projectId: publicConfig.walletConnectProjectId,
    chains: [chainId],
    showQrModal: true,
    metadata: {
      name: brand.name,
      description: brand.description,
      url: window.location.origin,
      icons: [`${window.location.origin}/icon.svg`],
    },
  });
  await provider.connect();
  return provider;
}
