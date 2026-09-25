import {
  createPublicClient,
  decodeEventLog,
  erc20Abi,
  getAddress,
  http,
  parseAbi,
  parseAbiItem,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import type { ChainReader, DepositTx, Erc20Transfer, PassState } from "./types";

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const FEED_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);
const PASS_ABI = parseAbi([
  "function price() view returns (uint256)",
  "function totalMinted() view returns (uint256)",
  "function maxSupply() view returns (uint256)",
  "function maxPerWallet() view returns (uint256)",
  "function mintOpen() view returns (bool)",
]);
const MAX_PRICE_AGE_S = 3 * 3600;

export interface ViemChainOptions {
  rpcUrl: string;
  chainId: number;
  explorerApiUrl?: string;
  explorerApiKey?: string;
}

export class ViemChain implements ChainReader {
  readonly client: PublicClient;
  private readonly decimals = new Map<string, number>();

  constructor(private readonly opts: ViemChainOptions) {
    this.client = createPublicClient({ transport: http(opts.rpcUrl, { timeout: 15_000, retryCount: 2 }) });
  }

  nativeBalance(address: Address): Promise<bigint> {
    return this.client.getBalance({ address });
  }

  tokenBalance(token: Address, address: Address): Promise<bigint> {
    return this.client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    });
  }

  async passState(pass: Address): Promise<PassState> {
    const read = <F extends "price" | "totalMinted" | "maxSupply" | "maxPerWallet" | "mintOpen">(
      functionName: F,
    ) => this.client.readContract({ address: pass, abi: PASS_ABI, functionName });
    const [priceWei, minted, maxSupply, maxPerWallet, mintOpen] = await Promise.all([
      read("price"),
      read("totalMinted"),
      read("maxSupply"),
      read("maxPerWallet"),
      read("mintOpen"),
    ]);
    return {
      priceWei,
      minted: Number(minted),
      maxSupply: Number(maxSupply),
      maxPerWallet: Number(maxPerWallet),
      mintOpen,
    };
  }

  async tokenDecimals(token: Address): Promise<number> {
    const key = token.toLowerCase();
    const cached = this.decimals.get(key);
    if (cached !== undefined) return cached;
    const d = await this.client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" });
    this.decimals.set(key, Number(d));
    return Number(d);
  }

  async firstTxTimestamp(address: Address): Promise<number | null> {
    if (!this.opts.explorerApiUrl) return null;
    const url = new URL(this.opts.explorerApiUrl);
    url.search = new URLSearchParams({
      chainid: String(this.opts.chainId),
      module: "account",
      action: "txlist",
      address,
      startblock: "0",
      endblock: "99999999",
      page: "1",
      offset: "1",
      sort: "asc",
      apikey: this.opts.explorerApiKey ?? "",
    }).toString();
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`explorer API returned ${res.status}`);
    const json = (await res.json()) as { status?: string; result?: { timeStamp?: string }[] | string };
    if (!Array.isArray(json.result)) return null; // "No transactions found" or an error string
    const ts = Number(json.result[0]?.timeStamp);
    return Number.isFinite(ts) && ts > 0 ? ts : null;
  }

  blockNumber(): Promise<bigint> {
    // viem caches the block number for a few seconds by default; confirmations need it fresh.
    return this.client.getBlockNumber({ cacheTime: 0 });
  }

  async blockTimestamp(block: bigint): Promise<number> {
    const b = await this.client.getBlock({ blockNumber: block });
    return Number(b.timestamp);
  }

  async erc20TransfersTo(
    token: Address,
    to: Address,
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<Erc20Transfer[]> {
    const logs = await this.client.getLogs({
      address: token,
      event: TRANSFER,
      args: { to },
      fromBlock,
      toBlock,
    });
    return logs
      .filter((l) => l.transactionHash && l.blockNumber !== null && l.logIndex !== null)
      .map((l) => ({
        txHash: l.transactionHash as Hex,
        logIndex: Number(l.logIndex),
        blockNumber: l.blockNumber as bigint,
        from: l.args.from as Address,
        value: l.args.value as bigint,
      }));
  }

  async getDepositTx(hash: Hex): Promise<DepositTx | null> {
    let tx;
    try {
      tx = await this.client.getTransaction({ hash });
    } catch (e) {
      if (e instanceof TransactionNotFoundError) return null;
      throw e;
    }
    let receipt;
    try {
      receipt = await this.client.getTransactionReceipt({ hash });
    } catch (e) {
      if (e instanceof TransactionReceiptNotFoundError) {
        return {
          status: "pending",
          confirmations: 0,
          from: tx.from,
          to: tx.to ?? null,
          value: tx.value,
          transfers: [],
        };
      }
      throw e;
    }
    const head = await this.blockNumber();
    const transfers: DepositTx["transfers"] = [];
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: [TRANSFER], data: log.data, topics: log.topics });
        transfers.push({
          token: getAddress(log.address),
          from: getAddress(ev.args.from),
          to: getAddress(ev.args.to),
          value: ev.args.value,
        });
      } catch {
        /* not a Transfer event */
      }
    }
    return {
      status: receipt.status === "success" ? "success" : "reverted",
      confirmations: Number(head - receipt.blockNumber + 1n),
      from: getAddress(tx.from),
      to: tx.to ? getAddress(tx.to) : null,
      value: tx.value,
      transfers,
    };
  }

  async ethUsdPrice(feed: Address): Promise<number> {
    const [decimals, round] = await Promise.all([
      this.client.readContract({ address: feed, abi: FEED_ABI, functionName: "decimals" }),
      this.client.readContract({ address: feed, abi: FEED_ABI, functionName: "latestRoundData" }),
    ]);
    const [, answer, , updatedAt] = round;
    if (answer <= 0n || Date.now() / 1000 - Number(updatedAt) > MAX_PRICE_AGE_S) {
      throw new Error("ETH/USD price feed is stale");
    }
    return Number(answer) / 10 ** decimals;
  }

  verifyMessage(args: { address: Address; message: string; signature: Hex }): Promise<boolean> {
    return this.client.verifyMessage(args);
  }
}
