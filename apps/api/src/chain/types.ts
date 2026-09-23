import type { Address, Hex } from "viem";

/** Everything the API reads from the blockchain. The real implementation uses viem; tests use a fake. */
export interface ChainReader {
  nativeBalance(address: Address): Promise<bigint>;
  tokenBalance(token: Address, address: Address): Promise<bigint>;
  tokenDecimals(token: Address): Promise<number>;
  /** Unix seconds of the wallet's first transaction, or null when unknown / no history. */
  firstTxTimestamp(address: Address): Promise<number | null>;
  blockNumber(): Promise<bigint>;
  blockTimestamp(block: bigint): Promise<number>;
  /** ERC-20 Transfer events of `token` into `to` between two blocks (inclusive). */
  erc20TransfersTo(token: Address, to: Address, fromBlock: bigint, toBlock: bigint): Promise<Erc20Transfer[]>;
  /** A transaction for deposit checks, or null when the hash is unknown. */
  getDepositTx(hash: Hex): Promise<DepositTx | null>;
  /** USD per ETH from a Chainlink feed. Throws if the answer is missing or older than 3 hours. */
  ethUsdPrice(feed: Address): Promise<number>;
  /** Signature check that also supports smart-contract wallets (ERC-1271 / ERC-6492). */
  verifyMessage(args: { address: Address; message: string; signature: Hex }): Promise<boolean>;
}

export interface Erc20Transfer {
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  from: Address;
  value: bigint;
}

export interface DepositTx {
  /** pending = not yet mined */
  status: "pending" | "success" | "reverted";
  confirmations: number;
  from: Address;
  to: Address | null;
  /** Native value sent. */
  value: bigint;
  /** ERC-20 Transfer events emitted by the transaction. */
  transfers: { token: Address; from: Address; to: Address; value: bigint }[];
}
