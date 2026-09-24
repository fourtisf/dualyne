/**
 * Model answers are Markdown; Telegram shows a small HTML subset. Everything is escaped first,
 * then code, bold, italics, headings, links and bullets become Telegram tags. Anything else
 * stays as plain text.
 */
export const TG_TEXT_MAX = 4096;

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const FENCE = /```([\w+-]*)[^\n]*\n([\s\S]*?)(?:```|$)/g;

function inline(text: string): string {
  const codes: string[] = [];
  let out = esc(text).replace(/`([^`\n]+)`/g, (_, code: string) => {
    codes.push(`<code>${code}</code>`);
    return `\uE000${codes.length - 1}\uE000`;
  });
  out = out
    .replace(/^#{1,6}\s+(.+?)\s*#*$/gm, "<b>$1</b>")
    .replace(/^(\s*)[-*+]\s+/gm, "$1• ")
    .replace(/\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*\w])\*(?![\s*])([^*\n]+?)(?<![\s*])\*(?![*\w])/g, "$1<i>$2</i>")
    .replace(/(^|[^_\w])_(?![\s_])([^_\n]+?)(?<![\s_])_(?![_\w])/g, "$1<i>$2</i>")
    .replace(/~~(?!\s)([^~\n]+?)(?<!\s)~~/g, "<s>$1</s>")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)"]+)\)/g, '<a href="$2">$1</a>');
  return out.replace(/\uE000(\d+)\uE000/g, (_, i: string) => codes[Number(i)]!);
}

/** Markdown from a model to Telegram HTML. */
export function toTelegramHtml(markdown: string): string {
  let out = "";
  let last = 0;
  for (const m of markdown.matchAll(FENCE)) {
    out += inline(markdown.slice(last, m.index));
    const lang = m[1] ? ` class="language-${m[1]}"` : "";
    out += `<pre><code${lang}>${esc(m[2]!.replace(/\n$/, ""))}</code></pre>`;
    last = m.index! + m[0].length;
  }
  return (out + inline(markdown.slice(last))).trim();
}

/**
 * Cut a Markdown answer into pieces that each fit one Telegram message after conversion.
 * Cuts at paragraph or line breaks; a code block that is cut is closed and reopened.
 */
export function splitMarkdown(text: string, max = 3500): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < max / 2) cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = rest.lastIndexOf(" ", max);
    if (cut < max / 2) cut = max;
    let head = rest.slice(0, cut).trimEnd();
    rest = rest.slice(cut).trimStart();
    const fences = head.match(/```/g)?.length ?? 0;
    if (fences % 2 === 1) {
      const lang = /```([\w+-]*)[^\n]*\n(?![\s\S]*```)/.exec(head)?.[1] ?? "";
      head += "\n```";
      rest = "```" + lang + "\n" + rest;
    }
    parts.push(head);
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Plain text for the fallback when Telegram refuses the HTML. */
export function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
