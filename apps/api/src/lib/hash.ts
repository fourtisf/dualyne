import { createHash, createHmac } from "node:crypto";

export const sha256Hex = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Keyed hash of an IP so raw addresses are never stored or used as Redis keys. */
export const hashIp = (secret: string, ip: string): string =>
  createHmac("sha256", secret || "dev-only-ip-secret")
    .update(ip)
    .digest("hex")
    .slice(0, 32);
