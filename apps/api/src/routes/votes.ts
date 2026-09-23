import { randomInt } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { voteRequestSchema, type LeaderboardResponse, type VoteResponse } from "@dualyne/shared";
import { SESSION_COOKIE } from "../auth/sessions";
import type { AppContext } from "../context";
import { recomputeElo } from "../elo";
import { ApiError } from "../lib/errors";

const CACHE_KEY = "cache:leaderboard";
const CACHE_TTL = 600;

export const blindOnly = (ctx: AppContext) => ctx.env.COMPARE_BLIND_MODE === "always";

/** Two different random ids from a list (for blind runs). */
export function pickTwo<T>(items: T[]): [T, T] {
  const i = randomInt(items.length);
  let j = randomInt(items.length - 1);
  if (j >= i) j++;
  return [items[i]!, items[j]!];
}

/** Community votes and the Elo leaderboard. */
export const voteRoutes: FastifyPluginAsync = async (app) => {
  const { ctx } = app;

  app.post("/votes", { config: { rateLimit: { max: 60, timeWindow: 60_000 } } }, async (req) => {
    const body = voteRequestSchema.parse(req.body);
    const run = await ctx.prisma.compareRun.findUnique({ where: { id: body.compareId } });
    if (!run) throw new ApiError(404, "compare_not_found", "That comparison doesn't exist.");
    // Tied to the (Turnstile-verified) browser that ran the comparison.
    if (run.ipHash !== ctx.ipHash(req.ip)) {
      throw new ApiError(403, "not_your_compare", "You can only vote on comparisons you ran.");
    }
    if (!run.completedA || !run.completedB) {
      throw new ApiError(409, "compare_incomplete", "Both answers must finish before you can vote.");
    }
    const ageHours = (ctx.clock().getTime() - run.createdAt.getTime()) / 3_600_000;
    if (ageHours > ctx.env.VOTE_WINDOW_HOURS) {
      throw new ApiError(410, "vote_closed", "Voting on this comparison has closed.");
    }
    const wallet = await ctx.sessions.get(req.cookies[SESSION_COOKIE]);
    await ctx.prisma.vote.upsert({
      where: { compareId: run.id },
      update: { winner: body.winner },
      create: {
        compareId: run.id,
        modelA: run.modelA,
        modelB: run.modelB,
        winner: body.winner,
        blind: run.blind,
        walletId: wallet?.id ?? null,
        ipHash: run.ipHash,
      },
    });
    const counted = run.modelA !== run.modelB && (!blindOnly(ctx) || run.blind);
    const res: VoteResponse = { ok: true, counted, a: run.modelA, b: run.modelB };
    return res;
  });

  app.get("/leaderboard", async (_req, reply) => {
    reply.header("cache-control", "public, max-age=60");
    const cached = await ctx.redis.get(CACHE_KEY);
    if (cached) return reply.type("application/json").send(cached);

    // Cold start: build the table once if votes exist but the nightly job hasn't run yet.
    if ((await ctx.prisma.eloRating.count()) === 0 && (await ctx.prisma.vote.count()) > 0) {
      await recomputeElo(ctx.prisma, { blindOnly: blindOnly(ctx) });
    }
    const [rows, totalVotes] = await Promise.all([
      ctx.prisma.eloRating.findMany({ orderBy: { rating: "desc" } }),
      ctx.prisma.vote.count({ where: blindOnly(ctx) ? { blind: true } : {} }),
    ]);
    const body: LeaderboardResponse = {
      updatedAt: rows[0]?.updatedAt.toISOString() ?? null,
      totalVotes,
      blindOnly: blindOnly(ctx),
      rows: rows
        .filter((r) => r.games > 0)
        .map((r) => ({
          modelId: r.modelId,
          rating: Math.round(r.rating),
          wins: r.wins,
          losses: r.losses,
          ties: r.ties,
          games: r.games,
        })),
    };
    const json = JSON.stringify(body);
    // Cache an empty board only briefly so the first votes show up soon after launch.
    await ctx.redis.set(CACHE_KEY, json, "EX", body.rows.length ? CACHE_TTL : 60);
    return reply.type("application/json").send(json);
  });
};

export const LEADERBOARD_CACHE_KEY = CACHE_KEY;
