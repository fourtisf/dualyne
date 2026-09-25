// Deploy and run the Dualyne Pass contract from your own machine or server.
//
//   PRIVATE_KEY=0x…  RPC_URL=https://…  node pass.mjs deploy
//   PRIVATE_KEY=0x…  RPC_URL=https://…  PASS=0x…  node pass.mjs open | close | status
//   … node pass.mjs price 0.02            (ETH per Pass)
//   … node pass.mjs reserve 0xWallet 10   (free mints for the team or giveaways)
//   … node pass.mjs withdraw 0xWallet     (send the mint money there)
//
// The key is read from the environment and never printed or saved. Use the wallet that should own
// the contract; only that wallet can open the mint, change the price or withdraw.
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, formatEther, http, isAddress, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const here = path.dirname(new URL(import.meta.url).pathname);
const build = JSON.parse(fs.readFileSync(path.join(here, "build", "DualynePass.json"), "utf8"));
const { PRIVATE_KEY, RPC_URL, PASS } = process.env;
const [cmd, ...args] = process.argv.slice(2);

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
if (!cmd)
  fail(
    "Usage: node pass.mjs deploy | open | close | status | price <eth> | reserve <to> <n> | withdraw <to>",
  );
if (!RPC_URL) fail("Set RPC_URL (the chain's JSON-RPC endpoint, same as the API's RPC_URL).");

const transport = http(RPC_URL);
const pub = createPublicClient({ transport });
const chainId = await pub.getChainId();
const chain = {
  id: chainId,
  name: `chain ${chainId}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};
const account = PRIVATE_KEY ? privateKeyToAccount(PRIVATE_KEY) : null;
const wallet = account ? createWalletClient({ account, chain, transport }) : null;
const needWallet = () => wallet ?? fail("Set PRIVATE_KEY (the owner wallet's key).");
const needPass = () => (PASS && isAddress(PASS) ? PASS : fail("Set PASS to the contract address."));

async function write(functionName, fnArgs = []) {
  const hash = await needWallet().writeContract({
    address: needPass(),
    abi: build.abi,
    functionName,
    args: fnArgs,
  });
  console.log(`sent ${functionName}: ${hash}`);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") fail(`${functionName} failed`);
  console.log("confirmed");
}
const read = (functionName, fnArgs = []) =>
  pub.readContract({ address: needPass(), abi: build.abi, functionName, args: fnArgs });

switch (cmd) {
  case "deploy": {
    const supply = BigInt(process.env.PASS_SUPPLY ?? "500");
    const perWallet = BigInt(process.env.PASS_PER_WALLET ?? "5");
    const price = parseEther(process.env.PASS_PRICE_ETH ?? "0.03");
    const owner = process.env.PASS_OWNER ?? needWallet().account.address;
    console.log(
      `Deploying on chain ${chainId}: ${supply} Passes, ${perWallet} per wallet, ${formatEther(price)} ETH each, owner ${owner}`,
    );
    const hash = await needWallet().deployContract({
      abi: build.abi,
      bytecode: build.bytecode,
      args: [supply, perWallet, price, owner],
    });
    console.log(`sent: ${hash}`);
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success" || !r.contractAddress) fail("deploy failed");
    console.log(`\nDualyne Pass deployed at ${r.contractAddress}`);
    console.log(
      "Next: put PASS_NFT_ADDRESS=" + r.contractAddress + " in the server's .env, deploy the site,",
    );
    console.log("then open the mint with: PASS=" + r.contractAddress + " node pass.mjs open");
    break;
  }
  case "open":
    await write("setMintOpen", [true]);
    break;
  case "close":
    await write("setMintOpen", [false]);
    break;
  case "price":
    if (!args[0]) fail("Usage: node pass.mjs price 0.02");
    await write("setPrice", [parseEther(args[0])]);
    break;
  case "reserve":
    if (!isAddress(args[0] ?? "") || !args[1]) fail("Usage: node pass.mjs reserve 0xWallet 10");
    await write("mintReserved", [args[0], BigInt(args[1])]);
    break;
  case "withdraw":
    if (!isAddress(args[0] ?? "")) fail("Usage: node pass.mjs withdraw 0xWallet");
    await write("withdraw", [args[0]]);
    break;
  case "status": {
    const [price, minted, max, per, open, owner] = await Promise.all(
      ["price", "totalMinted", "maxSupply", "maxPerWallet", "mintOpen", "owner"].map((f) => read(f)),
    );
    const balance = await pub.getBalance({ address: needPass() });
    console.log({
      chainId,
      price: `${formatEther(price)} ETH`,
      minted: `${minted} / ${max}`,
      perWallet: Number(per),
      mintOpen: open,
      owner,
      unwithdrawn: `${formatEther(balance)} ETH`,
    });
    break;
  }
  default:
    fail(`Unknown command: ${cmd}`);
}
