/**
 * The Dualyne Pass contract exactly as compiled in contracts/build (the bytecode that gets
 * deployed), run on a local Ganache chain: the mint rules, the owner functions, what the API reads,
 * and that the on-chain artwork matches the website's passSvg() character for character.
 */
import ganache from "ganache";
import { passPalette, passSvg } from "@dualyne/shared";
import {
  createWalletClient,
  decodeErrorResult,
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
import build from "../../../contracts/build/DualynePass.json";

const PORT = 19545 + Math.floor(Math.random() * 1000);
const RPC = `http://127.0.0.1:${PORT}`;
const chainDef = defineChain({
  id: 31337,
  name: "ganache",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
// Ganache's deterministic accounts.
const OWNER = privateKeyToAccount("0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d");
const USER = privateKeyToAccount("0x6cbed15c793ce57650b9877cf6fa156fbef513c4e6134f022a85b1ffdd59b2a1");
const PAYOUT: Address = "0x2222222222222222222222222222222222222222";
const PRICE = parseEther("0.01");
const abi = build.abi as Abi;

let server: { listen(port: number): Promise<void>; close(): Promise<void> };
let pass: Address;
const owner = createWalletClient({ account: OWNER, chain: chainDef, transport: http(RPC) });
const user = createWalletClient({ account: USER, chain: chainDef, transport: http(RPC) });
const chain = new ViemChain({ rpcUrl: RPC, chainId: 31337 });

async function send(wallet: typeof owner, functionName: string, args: unknown[] = [], value?: bigint) {
  const hash = await wallet.writeContract({ address: pass, abi, functionName, args, value } as never);
  const receipt = await chain.client.waitForTransactionReceipt({ hash });
  expect(receipt.status).toBe("success");
}
/** Ganache returns the revert data without viem naming the error, so decode it here. */
async function reverts(p: Promise<unknown>, errorName: string) {
  let err: unknown;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err, `expected ${errorName}`).toBeDefined();
  let data: Hex | undefined;
  for (let e = err as { data?: unknown; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    const d = e.data as unknown;
    if (typeof d === "string" && d.startsWith("0x")) data = d as Hex;
    // Ganache's estimateGas error: { data: { result: "0x<revert data>" } }
    else if (d && typeof d === "object" && "result" in d && typeof d.result === "string")
      data = d.result as Hex;
  }
  expect(data, String(err)).toBeDefined();
  expect(decodeErrorResult({ abi, data: data! }).errorName).toBe(errorName);
}
const read = (functionName: string, args: unknown[] = []) =>
  chain.client.readContract({ address: pass, abi, functionName, args });

beforeAll(async () => {
  server = ganache.server({
    chain: { chainId: 31337 },
    wallet: { deterministic: true },
    logging: { quiet: true },
  } as never);
  await server.listen(PORT);
  // 5 Passes, 2 per wallet, 0.01 ETH each, 5% royalty.
  const hash = await owner.deployContract({
    abi,
    bytecode: build.bytecode as Hex,
    args: [5n, 2n, PRICE, OWNER.address, 500n],
  });
  pass = getAddress((await chain.client.waitForTransactionReceipt({ hash })).contractAddress!);
}, 60_000);
afterAll(async () => server?.close());

describe("DualynePass on a real EVM", () => {
  it("starts closed, and only the owner can open it or change the price", async () => {
    expect(await chain.passState(pass)).toEqual({
      priceWei: PRICE,
      minted: 0,
      maxSupply: 5,
      maxPerWallet: 2,
      mintOpen: false,
    });
    await reverts(send(user, "mint", [1n], PRICE), "MintClosed");
    await reverts(send(user, "setMintOpen", [true]), "OwnableUnauthorizedAccount");
    await reverts(send(user, "setPrice", [1n]), "OwnableUnauthorizedAccount");
    await send(owner, "setMintOpen", [true]);
    expect((await chain.passState(pass)).mintOpen).toBe(true);
  });

  it("takes exactly the price, caps each wallet and the supply", async () => {
    await reverts(send(user, "mint", [1n], PRICE - 1n), "BadPayment");
    await reverts(send(user, "mint", [1n], PRICE * 2n), "BadPayment");
    await reverts(send(user, "mint", [0n], 0n), "BadQuantity");
    await send(user, "mint", [2n], PRICE * 2n);
    await reverts(send(user, "mint", [1n], PRICE), "WalletLimit");

    // What the API reads to decide Pro: balanceOf, through the same call used for ERC-20s.
    expect(await chain.tokenBalance(pass, USER.address)).toBe(2n);
    expect(await chain.tokenBalance(pass, PAYOUT)).toBe(0n);

    await reverts(send(user, "mintReserved", [USER.address, 1n]), "OwnableUnauthorizedAccount");
    await send(owner, "mintReserved", [OWNER.address, 3n]);
    expect((await chain.passState(pass)).minted).toBe(5);
    await reverts(send(owner, "mintReserved", [OWNER.address, 1n]), "SoldOut");
    expect(await read("totalSupply")).toBe(5n);
  });

  it("draws the same artwork as the website", async () => {
    for (const id of [1, 2, 5]) {
      const uri = String(await read("tokenURI", [BigInt(id)]));
      expect(uri.startsWith("data:application/json;base64,")).toBe(true);
      const meta = JSON.parse(Buffer.from(uri.split(",")[1]!, "base64").toString("utf8"));
      expect(meta.name).toBe(`Dualyne Pass #${String(id).padStart(4, "0")}`);
      expect(meta.attributes).toEqual([{ trait_type: "Color", value: passPalette(id).name }]);
      const image = String(meta.image);
      expect(image.startsWith("data:image/svg+xml;base64,")).toBe(true);
      expect(Buffer.from(image.split(",")[1]!, "base64").toString("utf8")).toBe(passSvg(id));
    }
    await reverts(read("tokenURI", [99n]), "ERC721NonexistentToken");
  });

  it("tells marketplaces about the collection and the royalty", async () => {
    const uri = String(await read("contractURI"));
    const meta = JSON.parse(Buffer.from(uri.split(",")[1]!, "base64").toString("utf8"));
    expect(meta).toMatchObject({ name: "Dualyne Pass", external_link: "https://dualyne.com/pass" });
    expect(Buffer.from(String(meta.image).split(",")[1]!, "base64").toString("utf8")).toBe(passSvg(1));

    // ERC-2981 and ERC-721 interface ids.
    expect(await read("supportsInterface", ["0x2a55205a"])).toBe(true);
    expect(await read("supportsInterface", ["0x80ac58cd"])).toBe(true);
    expect(await read("royaltyInfo", [1n, parseEther("1")])).toEqual([OWNER.address, parseEther("0.05")]);
    await reverts(send(user, "setRoyalty", [USER.address, 100n]), "OwnableUnauthorizedAccount");
    await send(owner, "setRoyalty", [PAYOUT, 250n]);
    expect(await read("royaltyInfo", [1n, parseEther("1")])).toEqual([PAYOUT, parseEther("0.025")]);
    await expect(send(owner, "setRoyalty", [PAYOUT, 1001n])).rejects.toThrow();
  });

  it("sends the mint money to the address the owner picks", async () => {
    await reverts(send(user, "withdraw", [USER.address]), "OwnableUnauthorizedAccount");
    await send(owner, "withdraw", [PAYOUT]);
    expect(await chain.nativeBalance(PAYOUT)).toBe(PRICE * 2n);
    expect(await chain.nativeBalance(pass)).toBe(0n);
  });
});
