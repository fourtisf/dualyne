import {
  createPublicClient,
  erc20Abi,
  http,
  parseAbiItem,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import type { ChainReader, Erc20Transfer } from "./types";

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

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
    return this.client.getBlockNumber();
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

  verifyMessage(args: { address: Address; message: string; signature: Hex }): Promise<boolean> {
    return this.client.verifyMessage(args);
  }
}
