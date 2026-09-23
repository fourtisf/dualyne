import { getAddress, isAddress, verifyMessage, type Address, type Hex } from "viem";
import { parseSiweMessage } from "viem/siwe";
import type { ChainReader } from "../chain/types";
import { ApiError } from "../lib/errors";

export interface SiweCheck {
  /** Allowed `domain` values (host[:port] of the website). */
  hosts: string[];
  /** Allowed `uri` origins. */
  origins: string[];
  chainId: number;
  now: Date;
  /** Atomically consumes a server-issued nonce. Returns false if unknown or already used. */
  consumeNonce(nonce: string): Promise<boolean>;
  /** When set, signatures from smart-contract wallets are accepted too. */
  chain: ChainReader | null;
}

const MAX_AGE_MS = 10 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const reject = (message: string) => new ApiError(401, "siwe_invalid", message);

/** Verify an EIP-4361 message and its signature. Returns the checksummed wallet address. */
export async function verifySiwe(message: string, signature: Hex, check: SiweCheck): Promise<Address> {
  const m = parseSiweMessage(message);
  if (!m.address || !isAddress(m.address)) throw reject("The sign-in message has no valid address.");
  if (!m.domain || !check.hosts.includes(m.domain))
    throw reject("The sign-in message is for another website.");
  let uriOrigin = "";
  try {
    uriOrigin = m.uri ? new URL(m.uri).origin : "";
  } catch {
    /* invalid URI */
  }
  if (!check.origins.includes(uriOrigin)) throw reject("The sign-in message is for another website.");
  if (m.version !== "1") throw reject("Unsupported sign-in message version.");
  if (m.chainId !== check.chainId) throw reject("The sign-in message is for another network.");

  const now = check.now.getTime();
  const issued = m.issuedAt?.getTime();
  if (issued === undefined || Number.isNaN(issued)) throw reject("The sign-in message has no issue time.");
  if (issued > now + CLOCK_SKEW_MS || now - issued > MAX_AGE_MS) throw reject("The sign-in message expired.");
  if (m.expirationTime && m.expirationTime.getTime() <= now) throw reject("The sign-in message expired.");
  if (m.notBefore && m.notBefore.getTime() > now + CLOCK_SKEW_MS)
    throw reject("The sign-in message isn't valid yet.");

  if (!m.nonce || !(await check.consumeNonce(m.nonce)))
    throw reject("This sign-in request was already used. Try again.");

  const address = getAddress(m.address);
  let ok = false;
  try {
    ok = check.chain
      ? await check.chain.verifyMessage({ address, message, signature })
      : await verifyMessage({ address, message, signature });
  } catch {
    ok = false;
  }
  if (!ok) throw reject("The signature doesn't match the wallet.");
  return address;
}
