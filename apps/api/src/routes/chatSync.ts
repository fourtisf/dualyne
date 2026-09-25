import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { syncedChatSchema, type SyncedChatsResponse } from "@dualyne/shared";
import { requireOwnOrigin, requireWallet } from "../auth/request";
import { ApiError } from "../lib/errors";

/** Chats kept per account; saving one more drops the oldest. */
const MAX_SYNCED = 100;
/** Size of one saved chat as JSON. */
const MAX_BYTES = 300_000;
const idParams = z.object({ id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/, "Invalid chat id") });

/**
 * Opt-in chat sync for signed-in accounts: the Chat page saves conversations here so they follow
 * the account to other devices. Only text is stored (file names, never file contents), and the
 * owner can delete one chat or all of them.
 */
export const chatSyncRoutes: FastifyPluginAsync = async (app) => {
  const { ctx } = app;
  const limit = { rateLimit: { max: 120, timeWindow: 60_000 } };

  app.get("/me/chats", { config: limit }, async (req, reply) => {
    reply.header("cache-control", "no-store");
    const wallet = await requireWallet(ctx, req);
    const rows = await ctx.prisma.syncedChat.findMany({
      where: { accountId: wallet.id },
      orderBy: { updatedAt: "desc" },
      take: MAX_SYNCED,
    });
    const body: SyncedChatsResponse = {
      chats: rows.map((r) => ({
        id: r.id,
        title: r.title,
        turns: r.turns as SyncedChatsResponse["chats"][number]["turns"],
        updatedAt: r.updatedAt.getTime(),
      })),
    };
    return body;
  });

  app.put("/me/chats/:id", { config: limit, bodyLimit: 512 * 1024 }, async (req, reply) => {
    requireOwnOrigin(ctx, req);
    const wallet = await requireWallet(ctx, req);
    const { id } = idParams.parse(req.params);
    const body = syncedChatSchema.parse(req.body);
    if (JSON.stringify(body.turns).length > MAX_BYTES) {
      throw new ApiError(413, "chat_too_large", "This chat is too long to sync.");
    }
    const updatedAt = new Date(Math.min(body.updatedAt, ctx.clock().getTime()));
    const existing = await ctx.prisma.syncedChat.findUnique({
      where: { accountId_id: { accountId: wallet.id, id } },
      select: { updatedAt: true },
    });
    // An older copy (from another device) never overwrites a newer one.
    if (existing && existing.updatedAt > updatedAt) return reply.status(204).send();
    await ctx.prisma.syncedChat.upsert({
      where: { accountId_id: { accountId: wallet.id, id } },
      create: { accountId: wallet.id, id, title: body.title, turns: body.turns, updatedAt },
      update: { title: body.title, turns: body.turns, updatedAt },
    });
    if (!existing) {
      const extra = await ctx.prisma.syncedChat.findMany({
        where: { accountId: wallet.id },
        orderBy: { updatedAt: "desc" },
        skip: MAX_SYNCED,
        select: { id: true },
      });
      if (extra.length) {
        await ctx.prisma.syncedChat.deleteMany({
          where: { accountId: wallet.id, id: { in: extra.map((x) => x.id) } },
        });
      }
    }
    return reply.status(204).send();
  });

  app.delete("/me/chats/:id", { config: limit }, async (req, reply) => {
    requireOwnOrigin(ctx, req);
    const wallet = await requireWallet(ctx, req);
    const { id } = idParams.parse(req.params);
    await ctx.prisma.syncedChat.deleteMany({ where: { accountId: wallet.id, id } });
    return reply.status(204).send();
  });

  /** Remove every synced chat (turning sync off). */
  app.delete("/me/chats", { config: limit }, async (req, reply) => {
    requireOwnOrigin(ctx, req);
    const wallet = await requireWallet(ctx, req);
    await ctx.prisma.syncedChat.deleteMany({ where: { accountId: wallet.id } });
    return reply.status(204).send();
  });
};
