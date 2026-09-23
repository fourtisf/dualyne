import { createPublicClient, erc20Abi, http, type Address, type Hex, type PublicClient } from "viem";
import type { ChainReader } from "./types";

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

  verifyMessage(args: { address: Address; message: string; signature: Hex }): Promise<boolean> {
    return this.client.verifyMessage(args);
  }
}
