import type { FastifyPluginAsync } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import { sha256Hex } from "../lib/hash";

const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const shortId = (len = 10) => Array.from(randomBytes(len), (b) => ALPHABET[b % ALPHABET.length]).join("");

const createBody = z.object({ compareId: z.string().min(1).max(40) }).strict();
const idParam = z.object({ id: z.string().regex(/^[A-Za-z0-9]{6,20}$/) });
const deleteBody = z.object({ token: z.string().min(10).max(100) }).strict();

interface Stored {
  prompt: string;
  a: string;
  b: string;
  answerA: string;
  answerB: string;
}

/** Public links to a comparison, created only when the person who ran it clicks Share. */
export const shareRoutes: FastifyPluginAsync = async (app) => {
  const { ctx } = app;

  app.post("/shares", { config: { rateLimit: { max: 20, timeWindow: 3_600_000 } } }, async (req, reply) => {
    const { compareId } = createBody.parse(req.body);
    const run = await ctx.prisma.compareRun.findUnique({ where: { id: compareId }, include: { vote: true } });
    if (!run || run.ipHash !== ctx.ipHash(req.ip)) {
      throw new ApiError(404, "compare_not_found", "Only the person who ran a comparison can share it.");
    }
    if (run.blind && !run.vote) {
      throw new ApiError(409, "vote_first", "Pick the better answer first, then share the result.");
    }
    const existing = await ctx.prisma.share.findUnique({ where: { compareId } });
    if (existing) return { id: existing.id, token: null };

    const raw = await ctx.redis.get(`cmpout:${compareId}`);
    if (!raw) {
      throw new ApiError(410, "expired", "Comparisons can be shared for an hour after they finish.");
    }
    const s = JSON.parse(raw) as Stored;
    const token = randomBytes(24).toString("base64url");
    const share = await ctx.prisma.share.create({
      data: {
        id: shortId(),
        compareId,
        prompt: s.prompt,
        modelA: s.a,
        modelB: s.b,
        answerA: s.answerA,
        answerB: s.answerB,
        deleteTokenHash: sha256Hex(token),
      },
    });
    // The delete token is returned once; the browser keeps it so the person can unshare later.
    return reply.status(201).send({ id: share.id, token });
  });

  app.get("/shares/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const s = await ctx.prisma.share.findUnique({ where: { id } });
    if (!s)
      throw new ApiError(404, "share_not_found", "This shared comparison doesn't exist or was removed.");
    reply.header("cache-control", "public, max-age=300");
    return {
      id: s.id,
      prompt: s.prompt,
      a: s.modelA,
      b: s.modelB,
      answerA: s.answerA,
      answerB: s.answerB,
      createdAt: s.createdAt,
    };
  });

  app.delete(
    "/shares/:id",
    { config: { rateLimit: { max: 30, timeWindow: 60_000 } } },
    async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const { token } = deleteBody.parse(req.body);
      const s = await ctx.prisma.share.findUnique({ where: { id } });
      if (!s || s.deleteTokenHash !== sha256Hex(token)) {
        throw new ApiError(404, "share_not_found", "This shared comparison doesn't exist or was removed.");
      }
      await ctx.prisma.share.delete({ where: { id } });
      return reply.status(204).send();
    },
  );
};
