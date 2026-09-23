import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import type { Env } from "./env";
import type { Clock } from "./lib/time";
import type { Alerter } from "./lib/alert";
import type { Quota } from "./quota";
import type { Budget } from "./budget";
import type { ApiKeyAuth } from "./auth/apiKey";
import type { OpenRouter } from "./openrouter/client";
import type { TierPolicies } from "./tiers";
import type { SlidingWindowLimiter } from "./limiter";
import type { ChainReader } from "./chain/types";
import type { Sessions } from "./auth/sessions";
import type { TierService } from "./tierService";
import type { SybilCheck } from "./sybil";
import type { Credits } from "./credits";

export interface AppContext {
  env: Env;
  prisma: PrismaClient;
  redis: Redis;
  clock: Clock;
  quota: Quota;
  budget: Budget;
  auth: ApiKeyAuth;
  openrouter: OpenRouter;
  tiers: TierPolicies;
  compareLimiter: SlidingWindowLimiter;
  alert: Alerter;
  ipHash: (ip: string) => string;
  /** null when RPC_URL is not configured. */
  chain: ChainReader | null;
  sessions: Sessions;
  tierService: TierService;
  sybil: SybilCheck;
  credits: Credits;
  /** Work that continues after a response has ended (usage logging). Awaited on shutdown. */
  track: (p: Promise<unknown>) => void;
  inflight: Set<Promise<unknown>>;
}

declare module "fastify" {
  interface FastifyInstance {
    ctx: AppContext;
  }
}
