import { z } from "zod";
import { MODEL_ID_RE } from "./models";

export const CHAT_MESSAGE_MAX = 8000;
export const CHAT_HISTORY_MAX = 20;
/** Characters across the whole conversation; longer chats start over. */
export const CHAT_TOTAL_MAX = 24000;

export const chatMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1, "Message is empty").max(CHAT_MESSAGE_MAX, "Message is too long"),
  })
  .strict();
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** POST /internal/chat: one free model, a short conversation, answered as a stream. */
export const chatRequestSchema = z
  .object({
    model: z.string().regex(MODEL_ID_RE),
    messages: z.array(chatMessageSchema).min(1).max(CHAT_HISTORY_MAX, "This chat is long. Start a new one."),
    turnstileToken: z.string().max(4096).optional(),
  })
  .strict()
  .refine((r) => r.messages[r.messages.length - 1]?.role === "user", {
    message: "The last message must be yours",
  })
  .refine((r) => r.messages.reduce((n, m) => n + m.content.length, 0) <= CHAT_TOTAL_MAX, {
    message: "This chat is long. Start a new one.",
  });
export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** Events on the /internal/chat SSE stream, keyed by SSE `event:` name. */
export interface ChatEvents {
  meta: { model: string };
  delta: { text: string };
  done: { outputTokens: number; totalMs: number };
  error: { code: "upstream_failed" };
  end: Record<string, never>;
}

/** Characters across a shared conversation. */
export const CHAT_SHARE_TOTAL_MAX = 60000;

/** POST /internal/chat/share: a conversation the visitor chose to publish by link. */
export const chatShareRequestSchema = z
  .object({
    model: z.string().regex(MODEL_ID_RE),
    title: z.string().trim().min(1).max(120),
    messages: z
      .array(chatMessageSchema)
      .min(2)
      .max(CHAT_HISTORY_MAX * 2),
  })
  .strict()
  .refine((r) => r.messages.every((m, i) => m.role === (i % 2 === 0 ? "user" : "assistant")), {
    message: "Messages must take turns, starting with a question",
  })
  .refine((r) => r.messages[r.messages.length - 1]?.role === "assistant", {
    message: "The conversation must end with an answer",
  })
  .refine((r) => r.messages.reduce((n, m) => n + m.content.length, 0) <= CHAT_SHARE_TOTAL_MAX, {
    message: "This chat is too long to share",
  });
export type ChatShareRequest = z.infer<typeof chatShareRequestSchema>;

/** GET /internal/chat/share/:id */
export interface SharedChat {
  id: string;
  model: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
}
