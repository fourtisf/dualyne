import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Local development: read the monorepo's root .env (Next.js only reads apps/web/.env*).
// Existing variables win, and NODE_ENV is never taken from the file.
const rootEnv = path.join(dirname, "../../.env");
if (fs.existsSync(rootEnv)) {
  for (const line of fs.readFileSync(rootEnv, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || m[1] === "NODE_ENV" || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}
const isDev = process.env.NODE_ENV !== "production";
const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
const apiOrigin = apiUrl ? new URL(apiUrl).origin : "";

// WalletConnect needs its relay and verify endpoints, only when it is enabled.
const wc = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
  ? {
      connect:
        " https://rpc.walletconnect.org https://rpc.walletconnect.com wss://relay.walletconnect.org wss://relay.walletconnect.com https://relay.walletconnect.org https://relay.walletconnect.com https://pulse.walletconnect.org https://api.web3modal.org https://explorer-api.walletconnect.com",
      frame: " https://verify.walletconnect.org https://verify.walletconnect.com",
      img: " https://*.walletconnect.com https://*.walletconnect.org https://api.web3modal.org",
    }
  : { connect: "", frame: "", img: "" };

const csp = [
  "default-src 'self'",
  // Next.js inlines small bootstrap scripts; Turnstile loads from Cloudflare.
  `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob:${wc.img}`,
  "font-src 'self'",
  `connect-src 'self' ${apiOrigin} https://challenges.cloudflare.com${wc.connect}${isDev ? " ws:" : ""}`.trim(),
  `frame-src https://challenges.cloudflare.com${wc.frame}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@dualyne/config", "@dualyne/shared"],
  experimental: {
    // Trace workspace packages into the standalone output.
    outputFileTracingRoot: path.join(dirname, "../../"),
  },
  // The Indonesian version was retired; old /id links land on the English page.
  async redirects() {
    return [
      { source: "/id", destination: "/", permanent: true },
      { source: "/id/:path*", destination: "/:path*", permanent: true },
    ];
  },
  async headers() {
    const security = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    ];
    if (!isDev) {
      security.push({ key: "Content-Security-Policy", value: csp });
      security.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
    }
    return [{ source: "/:path*", headers: security }];
  },
};

export default nextConfig;
