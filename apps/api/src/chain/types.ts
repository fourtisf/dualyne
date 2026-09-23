import type { Address, Hex } from "viem";

/** Everything the API reads from the blockchain. The real implementation uses viem; tests use a fake. */
export interface ChainReader {
  nativeBalance(address: Address): Promise<bigint>;
  tokenBalance(token: Address, address: Address): Promise<bigint>;
  tokenDecimals(token: Address): Promise<number>;
  /** Unix seconds of the wallet's first transaction, or null when unknown / no history. */
  firstTxTimestamp(address: Address): Promise<number | null>;
  /** Signature check that also supports smart-contract wallets (ERC-1271 / ERC-6492). */
  verifyMessage(args: { address: Address; message: string; signature: Hex }): Promise<boolean>;
}
