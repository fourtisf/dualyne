import { chatSuggestRequestSchema, type ChatSuggestResponse } from "@dualyne/shared";
import type { FastifyPluginAsync } from "fastify";
import { suggestFollowUps } from "../chat/suggest";
import { ApiError } from "../lib/errors";
import { answerKnown } from "./chatShares";
import { assertModelsLive } from "./v1.chat";

export { parseSuggestions } from "../chat/suggest";

/**
 * Follow-up questions shown under a Chat answer, so the conversation can go on with one tap.
 * Only for answers Dualyne itself wrote for this visitor in the last day (checked by fingerprint),
 * and never counted as a message.
 */
export const chatSuggestRoutes: FastifyPluginAsync = async (app) => {
  const { ctx } = app;

  app.post(
    "/internal/chat/suggest",
    { config: { rateLimit: { max: 30, timeWindow: 60_000 } }, bodyLimit: 128 * 1024 },
    async (req) => {
      assertModelsLive(ctx, "Chat opens soon.");
      const body = chatSuggestRequestSchema.parse(req.body);
      if (!(await answerKnown(ctx.redis, ctx.ipHash(req.ip), body.answer))) {
        throw new ApiError(409, "answer_not_verified", "Suggestions are only for answers written here.");
      }
      const res: ChatSuggestResponse = { questions: await suggestFollowUps(ctx, body.question, body.answer) };
      return res;
    },
  );
};
