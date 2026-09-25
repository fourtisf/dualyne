import { chatShareRequestSchema, type SharedChat } from "@dualyne/shared";
import type { FastifyPluginAsync } from "fastify";
import type { Redis } from "ioredis";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import { sha256Hex } from "../lib/hash";
import { shortId } from "./shares";

/** How long an answer can be shared after it was written. */
const ANSWER_TTL_SECONDS = 86_400;

const answerKey = (ipHash: string, text: string) => `chatans:${sha256Hex(`${ipHash}\n${text.trim()}`)}`;

/**
 * Remember that Dualyne wrote `text` for this visitor: only a hash of visitor + text, for a day, so
 * a shared chat can't put made-up words in a model's mouth. The text itself is not stored.
 */
export async function rememberAnswer(redis: Redis, ipHash: string, text: string): Promise<void> {
  if (!text.trim()) return;
  await redis.set(answerKey(ipHash, text), "1", "EX", ANSWER_TTL_SECONDS);
}

/** Whether Dualyne wrote `text` for this visitor in the last day. */
export async function answerKnown(redis: Redis, ipHash: string, text: string): Promise<boolean> {
  return (await redis.exists(answerKey(ipHash, text))) === 1;
}

const idParam = z.object({ id: z.string().regex(/^[A-Za-z0-9]{6,20}$/) });
const deleteBody = z.object({ token: z.string().min(10).max(100) }).strict();
const NOT_FOUND = "This shared chat doesn't exist or was removed.";

/** Public links to a chat, created only when the visitor clicks Share on the Chat page. */
export const chatShareRoutes: FastifyPluginAsync = async (app) => {
  const { ctx } = app;

  app.post(
    "/internal/chat/share",
    { config: { rateLimit: { max: 20, timeWindow: 3_600_000 } }, bodyLimit: 256 * 1024 },
    async (req, reply) => {
      const body = chatShareRequestSchema.parse(req.body);
      const model = await ctx.prisma.model.findUnique({ where: { id: body.model } });
      // Any chat model (Pro chats included); the answer fingerprints prove the text is real.
      if (!model || !model.enabled) {
        throw new ApiError(404, "model_not_found", "That model is not in the catalog.");
      }
      const ipHash = ctx.ipHash(req.ip);
      const answers = body.messages.filter((m) => m.role === "assistant");
      const known = await Promise.all(answers.map((m) => ctx.redis.exists(answerKey(ipHash, m.content))));
      if (known.some((k) => k === 0)) {
        throw new ApiError(
          409,
          "answer_not_verified",
          "Only chats answered in this browser in the last 24 hours can be shared.",
        );
      }
      const token = randomBytes(24).toString("base64url");
      const share = await ctx.prisma.chatShare.create({
        data: {
          id: shortId(),
          modelId: model.id,
          title: body.title,
          messages: body.messages,
          deleteTokenHash: sha256Hex(token),
          ipHash,
          createdAt: ctx.clock(),
        },
      });
      // The delete token is returned once; the browser keeps it so the person can unshare later.
      return reply.status(201).send({ id: share.id, token });
    },
  );

  app.get("/internal/chat/share/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const s = await ctx.prisma.chatShare.findUnique({ where: { id } });
    if (!s) throw new ApiError(404, "share_not_found", NOT_FOUND);
    reply.header("cache-control", "public, max-age=300");
    const body: SharedChat = {
      id: s.id,
      model: s.modelId,
      title: s.title,
      messages: s.messages as unknown as SharedChat["messages"],
      createdAt: s.createdAt.toISOString(),
    };
    return body;
  });

  app.delete(
    "/internal/chat/share/:id",
    { config: { rateLimit: { max: 30, timeWindow: 60_000 } } },
    async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const { token } = deleteBody.parse(req.body);
      const s = await ctx.prisma.chatShare.findUnique({ where: { id } });
      if (!s || s.deleteTokenHash !== sha256Hex(token)) throw new ApiError(404, "share_not_found", NOT_FOUND);
      await ctx.prisma.chatShare.delete({ where: { id } });
      return reply.status(204).send();
    },
  );
};
