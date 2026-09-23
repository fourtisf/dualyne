import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { generateApiKey } from "../src/auth/apiKey";
import { loadEnv } from "../src/env";
import { seedModels } from "../prisma/seed";
import type { ChainReader } from "../src/chain/types";

// ---------- fake OpenRouter + Turnstile ----------

export type UpstreamMode = "stream" | "json" | "error" | "hang" | "midstream-error";

export interface FakeUpstream {
  url: string;
  mode: UpstreamMode;
  errorStatus: number;
  /** Raw SSE body the stream mode sends (also used to assert byte-identical pass-through). */
  streamBody: string;
  requests: { path: string; body: Record<string, unknown>; headers: IncomingMessage["headers"] }[];
  aborted: number;
  catalog: {
    id: string;
    name: string;
    created: number;
    context_length: number;
    pricing: { prompt: string; completion: string };
  }[];
  close(): Promise<void>;
}

export const SAMPLE_STREAM =
  ": OPENROUTER PROCESSING\n\n" +
  'data: {"id":"gen-1","object":"chat.completion.chunk","model":"x","choices":[{"index":0,"delta":{"role":"assistant","content":"Hel"}}]}\n\n' +
  'data: {"id":"gen-1","object":"chat.completion.chunk","model":"x","choices":[{"index":0,"delta":{"content":"lo ✓"}}]}\n\n' +
  'data: {"id":"gen-1","object":"chat.completion.chunk","model":"x","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n';
export const USAGE_EVENT =
  'data: {"id":"gen-1","object":"chat.completion.chunk","model":"x","choices":[],"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10,"cost":0.00123}}\n\n';
export const DONE_EVENT = "data: [DONE]\n\n";

export async function startFakeUpstream(): Promise<FakeUpstream> {
  const state: FakeUpstream = {
    url: "",
    mode: "stream",
    errorStatus: 500,
    streamBody: SAMPLE_STREAM + USAGE_EVENT + DONE_EVENT,
    requests: [],
    aborted: 0,
    catalog: [],
    close: async () => undefined,
  };

  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const path = req.url ?? "";

    if (path.startsWith("/turnstile")) {
      const token = new URLSearchParams(raw).get("response");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ success: token === "good", hostname: "refract.dev", action: "compare" }));
      return;
    }
    if (path === "/v1/models") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: state.catalog }));
      return;
    }

    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    state.requests.push({ path, body, headers: req.headers });

    if (state.mode === "error") {
      res.statusCode = state.errorStatus;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: { message: "upstream says no", code: state.errorStatus } }));
      return;
    }
    if (state.mode === "json") {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "gen-json",
          object: "chat.completion",
          model: String(body.model),
          choices: [{ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6, cost: 0.0005 },
        }),
      );
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (state.mode === "hang") {
      res.write(SAMPLE_STREAM.split("\n\n")[1] + "\n\n");
      const timer = setInterval(() => res.write(": keepalive\n\n"), 20);
      res.on("close", () => {
        clearInterval(timer);
        state.aborted += 1;
      });
      return;
    }
    if (state.mode === "midstream-error") {
      res.write(SAMPLE_STREAM.split("\n\n").slice(1, 2).join("") + "\n\n");
      res.end('data: {"error":{"code":"server_error","message":"provider crashed"}}\n\n');
      return;
    }
    // Send in awkward slices to exercise the event splitter across chunk boundaries.
    const buf = Buffer.from(state.streamBody, "utf8");
    for (let i = 0; i < buf.length; i += 17) {
      res.write(buf.subarray(i, i + 17));
      await new Promise((r) => setTimeout(r, 1));
    }
    res.end();
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  state.close = () =>
    new Promise((r) => {
      server.closeAllConnections();
      server.close(() => r());
    });
  return state;
}

// ---------- app under test ----------

export interface TestContext {
  app: FastifyInstance;
  prisma: PrismaClient;
  redis: Redis;
  upstream: FakeUpstream;
  now: { value: Date };
  /** Wait for background work, then clear the database, Redis and the fake upstream's records. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createTestContext(
  envOverrides: Record<string, string> = {},
  opts: { chain?: ChainReader | null } = {},
): Promise<TestContext> {
  const upstream = await startFakeUpstream();
  const prisma = new PrismaClient();
  const redis = new Redis(process.env.REDIS_URL!);
  const now = { value: new Date("2026-09-23T12:00:00Z") };
  const env = loadEnv({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    OPENROUTER_API_KEY: "sk-or-test-secret",
    OPENROUTER_BASE_URL: `${upstream.url}/v1`,
    TURNSTILE_SECRET_KEY: "test-secret",
    TURNSTILE_VERIFY_URL: `${upstream.url}/turnstile`,
    WEB_ORIGINS: "http://localhost:3000",
    IP_HASH_SECRET: "test-ip-secret-test-ip-secret-test-ip",
    JOBS_ENABLED: "false",
    SESSION_SECRET: "test-session-secret-test-session-secret",
    ...envOverrides,
  });
  await resetState(prisma, redis);
  const app = await buildApp({ env, prisma, redis, clock: () => now.value, chain: opts.chain ?? null });
  await app.ready();
  return {
    app,
    prisma,
    redis,
    upstream,
    now,
    reset: async () => {
      await Promise.all([...app.ctx.inflight]);
      await resetState(prisma, redis);
      upstream.requests.length = 0;
      upstream.aborted = 0;
      upstream.catalog = [];
    },
    close: async () => {
      await app.close();
      await upstream.close();
      await prisma.$disconnect();
      redis.disconnect();
    },
  };
}

export async function resetState(prisma: PrismaClient, redis: Redis): Promise<void> {
  await redis.flushdb();
  await prisma.session.deleteMany();
  await prisma.usageLog.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.compareRun.deleteMany();
  await prisma.modelCheck.deleteMany();
  await prisma.model.deleteMany();
  await seedModels(prisma);
}

export async function createKey(
  prisma: PrismaClient,
  tier: "explorer" | "holder" | "builder" = "explorer",
  address = `0x${"a".repeat(39)}${Math.floor(Math.random() * 10)}`,
): Promise<{ key: string; keyId: string; address: string }> {
  const wallet = await prisma.wallet.upsert({
    where: { address },
    update: { tierOverride: tier },
    create: { address, tierOverride: tier },
  });
  const { key, hash, last4 } = generateApiKey();
  const row = await prisma.apiKey.create({ data: { walletId: wallet.id, hash, last4 } });
  return { key, keyId: row.id, address };
}

export const chat = (app: FastifyInstance, key: string | null, body: Record<string, unknown>) =>
  app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    payload: body,
  });

export const hello = (model: string, extra: Record<string, unknown> = {}) => ({
  model,
  messages: [{ role: "user", content: "Hello" }],
  ...extra,
});

/** Parse an SSE body into {event, data} pairs (comments skipped). */
export function parseSse(body: string): { event: string; data: string }[] {
  return body
    .split("\n\n")
    .filter((b) => b.trim() && !b.startsWith(":"))
    .map((block) => {
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        if (line.startsWith("data: ")) data.push(line.slice(6));
      }
      return { event, data: data.join("\n") };
    });
}

// ---------- fake chain + wallet sign-in ----------

import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import type { Address, Hex } from "viem";
import { verifyMessage } from "viem";

export class FakeChain implements ChainReader {
  balances = new Map<string, bigint>();
  tokenBalances = new Map<string, bigint>();
  firstTx = new Map<string, number>();
  failing = false;
  calls = 0;
  async nativeBalance(a: Address) {
    this.calls++;
    if (this.failing) throw new Error("rpc down");
    return this.balances.get(a.toLowerCase()) ?? 0n;
  }
  async tokenBalance(t: Address, a: Address) {
    this.calls++;
    if (this.failing) throw new Error("rpc down");
    return this.tokenBalances.get(`${t.toLowerCase()}:${a.toLowerCase()}`) ?? 0n;
  }
  async tokenDecimals() {
    return 18;
  }
  async firstTxTimestamp(a: Address) {
    return this.firstTx.get(a.toLowerCase()) ?? null;
  }
  verifyMessage(args: { address: Address; message: string; signature: Hex }) {
    return verifyMessage(args);
  }
}

export const WEB_ORIGIN = "http://localhost:3000";

export function newAccount(): PrivateKeyAccount {
  return privateKeyToAccount(generatePrivateKey());
}

export async function siweMessage(
  t: TestContext,
  account: PrivateKeyAccount,
  over: Partial<Parameters<typeof createSiweMessage>[0]> = {},
): Promise<string> {
  const { nonce } = (await t.app.inject({ method: "GET", url: "/auth/nonce" })).json() as { nonce: string };
  return createSiweMessage({
    domain: "localhost:3000",
    address: account.address,
    statement: "Sign in to Refract.",
    uri: WEB_ORIGIN,
    version: "1",
    chainId: 1,
    nonce,
    issuedAt: t.now.value,
    ...over,
  });
}

/** Sign in and return the session cookie header value. */
export async function signIn(
  t: TestContext,
  account = newAccount(),
): Promise<{ cookie: string; account: PrivateKeyAccount }> {
  const message = await siweMessage(t, account);
  const signature = await account.signMessage({ message });
  const res = await t.app.inject({
    method: "POST",
    url: "/auth/verify",
    headers: { origin: WEB_ORIGIN },
    payload: { message, signature },
  });
  if (res.statusCode !== 200) throw new Error(`sign-in failed: ${res.statusCode} ${res.body}`);
  const setCookie = String(res.headers["set-cookie"]);
  const cookie = setCookie.split(";")[0]!;
  return { cookie, account };
}
