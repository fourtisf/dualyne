# Dualyne Pass

An ERC-721 membership: a wallet that holds at least one Pass gets Dualyne Pro (every model in Chat,
Pro daily limits) for as long as it holds it. Adapted from nekara's `ProofKeys` mint (fixed supply,
price, per-wallet cap, owner reserve, withdraw) without tiers or a reveal. The artwork is drawn
on-chain and matches `passSvg()` in `packages/shared/src/pass.ts` exactly; `apps/api/test/pass-chain.test.ts`
checks that, and every mint rule, against the compiled bytecode on a local chain.

This folder is not part of the pnpm workspace. `build/DualynePass.json` is committed, so you only
need to compile after changing the contract.

```bash
cd contracts
npm install
node compile.mjs            # after editing DualynePass.sol; then run the API tests
```

## Launch

Use the wallet that should own the contract. The key is read from the environment, never saved.

```bash
export RPC_URL=https://…            # same chain as the API's SIWE_CHAIN_ID (8453 = Base)
export PRIVATE_KEY=0x…              # owner wallet; it pays the deploy gas

PASS_SUPPLY=500 PASS_PER_WALLET=5 PASS_PRICE_ETH=0.03 node pass.mjs deploy
```

Then put `PASS_NFT_ADDRESS=<address>` in the server's `.env` and run `deploy/pm2/deploy.sh`: the
site gets a **Pass** page and holders get Pro. Open the sale when you're ready:

```bash
export PASS=0x…                     # the deployed address
node pass.mjs open                  # start minting (close stops it)
node pass.mjs status                # price, minted, open, ETH waiting to be withdrawn
node pass.mjs price 0.02            # change the price (ETH)
node pass.mjs reserve 0xWallet 10   # free Passes for the team or giveaways (count toward supply)
node pass.mjs withdraw 0xWallet     # send the mint money there
```

Supply and the per-wallet cap are fixed at deploy. Price, open/closed and withdrawals stay with the
owner. Verify the source on the block explorer with solc 0.8.26, optimizer 200 runs, viaIR, evmVersion
paris, and OpenZeppelin Contracts 5.1.0.
