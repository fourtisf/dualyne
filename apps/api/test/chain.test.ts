/**
 * Runs the real viem ChainReader against a local Ganache chain with test ERC-20 and price-feed
 * contracts (compiled from test/fixtures/Contracts.sol), so the on-chain code paths are tested
 * against a real EVM, not only the fake.
 */
import ganache from "ganache";
import {
  createWalletClient,
  defineChain,
  getAddress,
  http,
  parseEther,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ViemChain } from "../src/chain/viem";
import { treasuryConfig } from "../src/routes/treasury";
import { syncTreasury } from "../src/treasury";
import fixture from "./fixtures/contracts.json";
import { createTestContext, siweMessage, WEB_ORIGIN, type TestContext } from "./helpers";

const PORT = 18545 + Math.floor(Math.random() * 1000);
const RPC = `http://127.0.0.1:${PORT}`;
const chainDef = defineChain({
  id: 31337,
  name: "ganache",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
// Ganache's deterministic accounts.
const DEPLOYER = privateKeyToAccount("0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d");
const USER = privateKeyToAccount("0x6cbed15c793ce57650b9877cf6fa156fbef513c4e6134f022a85b1ffdd59b2a1");
const TREASURY: Address = "0x2222222222222222222222222222222222222222";

let server: { listen(port: number): Promise<void>; close(): Promise<void> };
let dlyn: Address;
let usdg: Address;
let feed: Address;
const deployer = createWalletClient({ account: DEPLOYER, chain: chainDef, transport: http(RPC) });
const user = createWalletClient({ account: USER, chain: chainDef, transport: http(RPC) });
const chain = new ViemChain({ rpcUrl: RPC, chainId: 31337 });

async function deploy(name: "TestToken" | "TestFeed", args: unknown[]): Promise<Address> {
  const hash = await deployer.deployContract({
    abi: fixture[name].abi as Abi,
    bytecode: fixture[name].bytecode as Hex,
    args,
  });
  const receipt = await chain.client.waitForTransactionReceipt({ hash });
  return getAddress(receipt.contractAddress!);
}
const tokenAbi = fixture.TestToken.abi as Abi;
const mine = (n: number) =>
  chain.client.request({ method: "evm_mine" as never, params: [{ blocks: n }] as never }).catch(async () => {
    for (let i = 0; i < n; i++) await chain.client.request({ method: "evm_mine" as never });
  });

beforeAll(async () => {
  // Ganache's option types are narrower than its runtime; these options are documented ones.
  server = ganache.server({
    chain: { chainId: 31337 },
    wallet: { deterministic: true },
    logging: { quiet: true },
  } as never);
  await server.listen(PORT);
  dlyn = await deploy("TestToken", ["Dualyne", "DLYN", 18]);
  usdg = await deploy("TestToken", ["USD Global", "USDG", 6]);
  feed = await deploy("TestFeed", [2500n * 10n ** 8n]);
  for (const [token, amount] of [
    [dlyn, 150_000n * 10n ** 18n],
    [usdg, 100n * 10n ** 6n],
  ] as const) {
    const hash = await deployer.writeContract({
      address: token,
      abi: tokenAbi,
      functionName: "mint",
      args: [USER.address, amount],
    });
    await chain.client.waitForTransactionReceipt({ hash });
  }
}, 60_000);
afterAll(async () => server?.close());

describe("ViemChain against a real EVM", () => {
  it("reads native and ERC-20 balances and decimals", async () => {
    expect(await chain.nativeBalance(USER.address)).toBeGreaterThan(parseEther("1"));
    expect(await chain.tokenBalance(dlyn, USER.address)).toBe(150_000n * 10n ** 18n);
    expect(await chain.tokenDecimals(usdg)).toBe(6);
  });

  it("finds Transfer events into an address and reads deposit transactions", async () => {
    const hash = await user.writeContract({
      address: usdg,
      abi: tokenAbi,
      functionName: "transfer",
      args: [TREASURY, 40n * 10n ** 6n],
    });
    const receipt = await chain.client.waitForTransactionReceipt({ hash });
    const head = await chain.blockNumber();
    const logs = await chain.erc20TransfersTo(usdg, TREASURY, 0n, head);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      txHash: hash,
      from: USER.address,
      value: 40n * 10n ** 6n,
      blockNumber: receipt.blockNumber,
    });
    expect(Math.abs((await chain.blockTimestamp(receipt.blockNumber)) - Date.now() / 1000)).toBeLessThan(120);

    await mine(3);
    const tx = await chain.getDepositTx(hash);
    expect(tx).toMatchObject({ status: "success", from: USER.address });
    expect(tx!.confirmations).toBeGreaterThanOrEqual(4);
    expect(tx!.transfers).toEqual([
      { token: usdg, from: USER.address, to: TREASURY, value: 40n * 10n ** 6n },
    ]);

    const ethHash = await user.sendTransaction({ to: TREASURY, value: parseEther("0.01") });
    await chain.client.waitForTransactionReceipt({ hash: ethHash });
    expect((await chain.getDepositTx(ethHash))!.value).toBe(parseEther("0.01"));
    expect(await chain.getDepositTx(`0x${"ab".repeat(32)}`)).toBeNull();
  });

  it("reads a Chainlink-style ETH/USD price", async () => {
    expect(await chain.ethUsdPrice(feed)).toBe(2500);
  });

  it("verifies wallet signatures", async () => {
    const signature = await USER.signMessage({ message: "hello" });
    expect(await chain.verifyMessage({ address: USER.address, message: "hello", signature })).toBe(true);
    expect(await chain.verifyMessage({ address: DEPLOYER.address, message: "hello", signature })).toBe(false);
  });
});

describe("end to end on a real EVM", () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestContext(
      {
        SIWE_CHAIN_ID: "1",
        DLYN_TOKEN_ADDRESS: dlyn,
        TREASURY_WALLET_ADDRESS: TREASURY,
        USDG_TOKEN_ADDRESS: usdg,
        DEPOSIT_ADDRESS: TREASURY,
        ETH_USD_FEED_ADDRESS: feed,
        CHAIN_CONFIRMATIONS: "2",
        TREASURY_START_BLOCK: "0",
        SYBIL_CHECK: "on",
      },
      { chain },
    );
  });
  afterAll(async () => t?.close());

  it("signs in, is Holder by DLYN balance, and credits a USDG top-up", async () => {
    const message = await siweMessage(t, USER);
    const signature = await USER.signMessage({ message });
    const login = await t.app.inject({
      method: "POST",
      url: "/auth/verify",
      headers: { origin: WEB_ORIGIN },
      payload: { message, signature },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toMatchObject({ tier: "holder", tierSource: "token", token: { balance: 150000 } });
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;

    const hash = await user.writeContract({
      address: usdg,
      abi: tokenAbi,
      functionName: "transfer",
      args: [TREASURY, 10n * 10n ** 6n],
    });
    await chain.client.waitForTransactionReceipt({ hash });
    await mine(2);
    const res = await t.app.inject({
      method: "POST",
      url: "/me/credits/deposits",
      headers: { cookie, origin: WEB_ORIGIN },
      payload: { txHash: hash },
    });
    expect(res.json()).toMatchObject({ status: "credited", asset: "USDG", amount: "10", usd: 10 });
  });

  it("syncs treasury inflows from real logs", async () => {
    const r = await syncTreasury(t.prisma, treasuryConfig(t.app.ctx)!, () => new Date());
    expect(r.inserted).toBeGreaterThanOrEqual(2); // 40 USDG earlier + the 10 USDG top-up
    const total = await t.prisma.treasuryTransfer.aggregate({ _sum: { amountMicroUsd: true } });
    expect(total._sum.amountMicroUsd).toBe(50_000_000n);
    const snap = await t.prisma.treasurySnapshot.findFirstOrThrow({ orderBy: { takenAt: "desc" } });
    expect(snap.balanceMicroUsd).toBe(50_000_000n);
  });
});
