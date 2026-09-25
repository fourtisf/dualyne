// Compiles DualynePass.sol into build/DualynePass.json (ABI + bytecode). The build is committed, so
// the API tests and deploy.mjs use exactly the bytecode that was reviewed.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const solc = require("solc");
const here = path.dirname(new URL(import.meta.url).pathname);

const input = {
  language: "Solidity",
  sources: { "DualynePass.sol": { content: fs.readFileSync(path.join(here, "DualynePass.sol"), "utf8") } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    // paris: runs on every EVM chain (Base, Ethereum, Arbitrum) and on Ganache in the API tests.
    evmVersion: "paris",
    outputSelection: { "*": { DualynePass: ["abi", "evm.bytecode.object"] } },
  },
};
const findImports = (p) => {
  const file = path.join(here, "node_modules", p);
  return fs.existsSync(file) ? { contents: fs.readFileSync(file, "utf8") } : { error: `not found: ${p}` };
};
const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
const errors = (out.errors ?? []).filter((e) => e.severity === "error");
for (const w of (out.errors ?? []).filter((e) => e.severity !== "error")) console.warn("warning:", w.message);
if (errors.length) {
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}
const c = out.contracts["DualynePass.sol"].DualynePass;
const bytecode = `0x${c.evm.bytecode.object}`;
const size = (bytecode.length - 2) / 2;
fs.mkdirSync(path.join(here, "build"), { recursive: true });
fs.writeFileSync(
  path.join(here, "build", "DualynePass.json"),
  JSON.stringify({ compiler: `solc ${solc.version()}`, evmVersion: "paris", abi: c.abi, bytecode }, null, 2) +
    "\n",
);
console.log(`DualynePass compiled: ${(size / 1024).toFixed(1)} KB (deployed code limit is 24 KB)`);
