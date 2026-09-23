import { getAddress, stringToHex } from "viem";
import { createSiweMessage } from "viem/siwe";
import { brand } from "@refract/config";
import type { MeResponse } from "@refract/shared";
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

export class WalletFlowError extends Error {}

/** Sign-In With Ethereum: one signature, no transaction, no gas. */
export async function signInWithWallet(provider: Eip1193): Promise<MeResponse> {
  let accounts: string[];
  try {
    accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  } catch {
    throw new WalletFlowError("Connection was cancelled in your wallet. Connect again when you're ready.");
  }
  const raw = accounts?.[0];
  if (!raw) throw new WalletFlowError("Your wallet didn't share an address. Try again.");
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
    throw new WalletFlowError("Signing was cancelled in your wallet. Connect again when you're ready.");
  }
  return apiFetch<MeResponse>("/auth/verify", { method: "POST", body: { message, signature } });
}

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
