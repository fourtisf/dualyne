/**
 * The Dualyne Pass NFT (contracts/DualynePass.sol). Holding one gives the wallet Pro.
 * passSvg() draws the same artwork as the contract's tokenURI(), character for character, so the
 * mint page shows exactly what the buyer receives; a test in the API compares the two.
 */

export const PASS_PALETTES = [
  { name: "Violet", a: "#7C5CFF", b: "#22D3EE" },
  { name: "Orchid", a: "#A78BFA", b: "#F472B6" },
  { name: "Mint", a: "#34D399", b: "#22D3EE" },
  { name: "Sunset", a: "#F59E0B", b: "#F472B6" },
  { name: "Ocean", a: "#60A5FA", b: "#A78BFA" },
  { name: "Ember", a: "#F87171", b: "#FBBF24" },
] as const;

export const passPalette = (tokenId: number) => PASS_PALETTES[tokenId % PASS_PALETTES.length]!;
export const passNumber = (tokenId: number) => String(tokenId).padStart(4, "0");

/** The Pass artwork as SVG text. Keep in step with svg() in DualynePass.sol. */
export function passSvg(tokenId: number): string {
  const { a, b } = passPalette(tokenId);
  const id = String(tokenId);
  const num = passNumber(tokenId);
  return (
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 600'>" +
    `<defs><linearGradient id='g${id}' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient>` +
    `<radialGradient id='r${id}' cx='.3' cy='.2' r='.9'>` +
    `<stop offset='0' stop-color='${a}' stop-opacity='.35'/><stop offset='1' stop-color='${a}' stop-opacity='0'/></radialGradient></defs>` +
    "<rect width='600' height='600' fill='#07070A'/>" +
    `<rect width='600' height='600' fill='url(#r${id})'/>` +
    `<rect x='60' y='120' width='480' height='360' rx='28' fill='#0E0E13' stroke='url(#g${id})' stroke-width='3'/>` +
    `<path d='M104 176l22 18-22 18' fill='none' stroke='url(#g${id})' stroke-width='7' stroke-linecap='round' stroke-linejoin='round'/>` +
    `<path d='M138 200h26M138 212h18' stroke='url(#g${id})' stroke-width='6' stroke-linecap='round'/>` +
    "<text x='104' y='300' font-family='monospace' font-size='44' font-weight='700' fill='#F4F4F6'>DUALYNE PASS</text>" +
    "<text x='104' y='346' font-family='monospace' font-size='20' fill='#9A9AA6'>Pro access &#183; every model</text>" +
    `<text x='104' y='432' font-family='monospace' font-size='22' fill='url(#g${id})'>#${num}</text>` +
    "<text x='496' y='432' text-anchor='end' font-family='monospace' font-size='18' fill='#6B6B78'>dualyne.com</text>" +
    "</svg>"
  );
}

/** GET /pass: the sale, read from the contract. */
export interface PassInfo {
  /** A Pass contract is configured. */
  enabled: boolean;
  address: string | null;
  chainId: number;
  /** Price per Pass in wei, as a decimal string. Null when the chain can't be read. */
  priceWei: string | null;
  minted: number | null;
  maxSupply: number | null;
  maxPerWallet: number | null;
  mintOpen: boolean;
}
