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

/** Attachments: images (vision models), PDFs (read as text) and text files. */
export const CHAT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
/** A data: URL of an image after the browser shrinks it, in characters. */
export const CHAT_IMAGE_MAX = 1_500_000;
/** A PDF as a data: URL (about 4 MB of file). */
export const CHAT_PDF_MAX = 5_600_000;
/** All image and PDF data in one request, in characters. */
export const CHAT_FILES_TOTAL_MAX = 14_000_000;
/** Characters of one text file, and of all attached text in a chat. */
export const CHAT_TEXT_FILE_MAX = 60_000;
export const CHAT_TEXT_TOTAL_MAX = 120_000;
export const CHAT_ATTACHMENTS_PER_MESSAGE = 4;
export const CHAT_IMAGES_TOTAL_MAX = 8;
export const CHAT_PDFS_TOTAL_MAX = 2;
/** Custom instructions, sent before the conversation. */
export const CHAT_INSTRUCTIONS_MAX = 1500;

const fileName = z.string().trim().min(1).max(120);
export const chatAttachmentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("image"),
      name: fileName,
      data: z
        .string()
        .max(CHAT_IMAGE_MAX, "Image is too large")
        .regex(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/, "Unsupported image"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("pdf"),
      name: fileName,
      data: z
        .string()
        .max(CHAT_PDF_MAX, "PDF is too large (max 4 MB)")
        .regex(/^data:application\/pdf;base64,[A-Za-z0-9+/=]+$/, "Unsupported PDF"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("text"),
      name: fileName,
      text: z.string().min(1).max(CHAT_TEXT_FILE_MAX, "Text file is too long"),
    })
    .strict(),
]);
export type ChatAttachment = z.infer<typeof chatAttachmentSchema>;

/** A message sent to /internal/chat: text plus optional files on the visitor's messages. */
export const chatTurnSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().max(CHAT_MESSAGE_MAX, "Message is too long"),
    attachments: z.array(chatAttachmentSchema).max(CHAT_ATTACHMENTS_PER_MESSAGE).optional(),
  })
  .strict()
  .refine((m) => m.content.length > 0 || (m.role === "user" && m.attachments?.length), {
    message: "Message is empty",
  })
  .refine((m) => m.role === "user" || !m.attachments?.length, {
    message: "Only your messages can have files",
  });
export type ChatTurn = z.infer<typeof chatTurnSchema>;

const attached = (r: { messages: ChatTurn[] }) => r.messages.flatMap((m) => m.attachments ?? []);

/** POST /internal/chat: one model, a short conversation, answered as a stream. */
export const chatRequestSchema = z
  .object({
    model: z.string().regex(MODEL_ID_RE),
    messages: z.array(chatTurnSchema).min(1).max(CHAT_HISTORY_MAX, "This chat is long. Start a new one."),
    /** Custom instructions from the visitor's settings. */
    instructions: z.string().trim().max(CHAT_INSTRUCTIONS_MAX, "Instructions are too long").optional(),
    /** Let the model search the web for this answer. */
    webSearch: z.boolean().optional(),
    turnstileToken: z.string().max(4096).optional(),
  })
  .strict()
  .refine((r) => r.messages[r.messages.length - 1]?.role === "user", {
    message: "The last message must be yours",
  })
  .refine((r) => r.messages.reduce((n, m) => n + m.content.length, 0) <= CHAT_TOTAL_MAX, {
    message: "This chat is long. Start a new one.",
  })
  .refine((r) => attached(r).filter((a) => a.kind === "image").length <= CHAT_IMAGES_TOTAL_MAX, {
    message: `Up to ${CHAT_IMAGES_TOTAL_MAX} images per chat. Start a new chat for more.`,
  })
  .refine((r) => attached(r).filter((a) => a.kind === "pdf").length <= CHAT_PDFS_TOTAL_MAX, {
    message: `Up to ${CHAT_PDFS_TOTAL_MAX} PDFs per chat. Start a new chat for more.`,
  })
  .refine(
    (r) =>
      attached(r).reduce((n, a) => n + (a.kind === "text" ? a.text.length : 0), 0) <= CHAT_TEXT_TOTAL_MAX,
    { message: "The attached text is too long. Start a new chat." },
  )
  .refine(
    (r) =>
      attached(r).reduce((n, a) => n + (a.kind === "text" ? 0 : a.data.length), 0) <= CHAT_FILES_TOTAL_MAX,
    { message: "The files in this chat are too large together. Start a new chat." },
  );
export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** Events on the /internal/chat SSE stream, keyed by SSE `event:` name. */
export interface ChatEvents {
  meta: { model: string };
  delta: { text: string };
  /** Web pages the answer used, when web search was on. */
  sources: { sources: { url: string; title: string }[] };
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

/** GET /internal/chat/quota: the caller's plan and messages left today. */
export type ChatQuota = (
  | { plan: "free"; limit: number; remaining: number }
  | {
      plan: "pro";
      limit: number;
      remaining: number;
      premiumLimit: number;
      premiumRemaining: number;
      proUntil: string;
    }
) & { webLimit: number; webRemaining: number };

/** A Chat conversation kept in sync with the account (PUT /me/chats/:id). File contents never included. */
const syncSource = z.object({ url: z.string().url().max(2000), title: z.string().max(300) }).strict();
export const syncedTurnSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(40_000),
    model: z.string().max(40).optional(),
    failed: z.boolean().optional(),
    attachments: z
      .array(
        z
          .object({
            kind: z.enum(["image", "pdf", "text"]),
            name: z.string().max(120),
            gone: z.literal(true),
          })
          .strict(),
      )
      .max(CHAT_ATTACHMENTS_PER_MESSAGE)
      .optional(),
    sources: z.array(syncSource).max(10).optional(),
    alts: z
      .array(
        z
          .object({
            model: z.string().max(40),
            content: z.string().max(40_000),
            failed: z.boolean().optional(),
            error: z.string().max(300).optional(),
            sources: z.array(syncSource).max(10).optional(),
          })
          .strict(),
      )
      .max(4)
      .optional(),
    picked: z.number().int().min(0).max(3).optional(),
  })
  .strict();
export const syncedChatSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    turns: z.array(syncedTurnSchema).max(CHAT_HISTORY_MAX * 3),
    /** Milliseconds since 1970, from the browser that changed it. */
    updatedAt: z.number().int().positive(),
  })
  .strict();
export type SyncedChatBody = z.infer<typeof syncedChatSchema>;

/** GET /me/chats */
export interface SyncedChatsResponse {
  chats: (SyncedChatBody & { id: string })[];
}
