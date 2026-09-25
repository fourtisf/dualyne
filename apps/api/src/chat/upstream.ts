import type { ChatRequest } from "@dualyne/shared";
import { estimateTokens } from "../lib/money";

/** Rough input tokens per image, used only to reserve budget before the real cost is known. */
const IMAGE_TOKENS = 1600;

type Part =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

export interface UpstreamChat {
  messages: { role: "system" | "user" | "assistant"; content: string | Part[] }[];
  /** OpenRouter plugins the request needs (PDF reading, web search). */
  plugins: Record<string, unknown>[];
  hasImages: boolean;
  /** Estimated input tokens, including files. */
  inputTokens: number;
}

/**
 * Turn a website chat request into OpenRouter's format: text files are added to the message
 * text, images and PDFs become content parts, custom instructions become the system message.
 */
export function toUpstream(body: ChatRequest, opts: { webResults: number }): UpstreamChat {
  let chars = 0;
  let extraTokens = 0;
  let hasImages = false;
  let hasPdf = false;
  const messages: UpstreamChat["messages"] = [];
  if (body.instructions) {
    messages.push({
      role: "system",
      content: `The user set these instructions for every chat. Follow them unless they ask for something unsafe:\n${body.instructions}`,
    });
    chars += body.instructions.length;
  }
  for (const m of body.messages) {
    let text = m.content;
    const parts: Part[] = [];
    for (const a of m.attachments ?? []) {
      if (a.kind === "text") {
        text += `\n\n<file name="${a.name.replace(/"/g, "'")}">\n${a.text}\n</file>`;
      } else if (a.kind === "image") {
        hasImages = true;
        extraTokens += IMAGE_TOKENS;
        parts.push({ type: "image_url", image_url: { url: a.data } });
      } else {
        hasPdf = true;
        // Base64 is 4/3 of the file; a PDF's text is usually a small part of its bytes.
        extraTokens += Math.min(200_000, Math.ceil((a.data.length * 0.75) / 8));
        parts.push({ type: "file", file: { filename: a.name, file_data: a.data } });
      }
    }
    chars += text.length;
    messages.push({
      role: m.role,
      content: parts.length ? [{ type: "text", text: text || "(see the attached file)" }, ...parts] : text,
    });
  }
  const plugins: Record<string, unknown>[] = [];
  if (hasPdf) plugins.push({ id: "file-parser", pdf: { engine: "pdf-text" } });
  if (opts.webResults > 0) plugins.push({ id: "web", max_results: opts.webResults });
  return { messages, plugins, hasImages, inputTokens: estimateTokens(chars) + extraTokens };
}
