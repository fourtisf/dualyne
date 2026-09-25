import { CHAT_IMAGE_MAX, CHAT_PDF_MAX, CHAT_TEXT_FILE_MAX, type ChatAttachment } from "@dualyne/shared";

/** An attachment in the chat. After a reload only its name is left (files aren't saved). */
export type Attached = ChatAttachment | { kind: ChatAttachment["kind"]; name: string; gone: true };

export const isSendable = (a: Attached): a is ChatAttachment => !("gone" in a);

/** What the file picker offers. */
export const ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,application/pdf,.txt,.md,.csv,.json,.js,.ts,.tsx,.jsx,.py,.html,.css,.xml,.yml,.yaml,.sql,.log";

const TEXT_EXT = /\.(txt|md|csv|json|js|ts|tsx|jsx|py|html|css|xml|ya?ml|sql|log)$/i;
/** Longest side of an image after shrinking: enough detail for the models, a small upload. */
const IMAGE_SIDE = 1568;

export class AttachError extends Error {}

const readAs = (file: File, how: "dataUrl" | "text") =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new AttachError(`Couldn't read ${file.name}.`));
    if (how === "dataUrl") r.readAsDataURL(file);
    else r.readAsText(file);
  });

/** Shrink an image to at most IMAGE_SIDE px and re-encode it as JPEG (PNG kept for small files). */
async function shrinkImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new AttachError(`${file.name} isn't an image we can open.`));
      i.src = url;
    });
    const scale = Math.min(1, IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale === 1 && file.size < 900_000 && file.type !== "image/gif") return await readAs(file, "dataUrl");
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const g = canvas.getContext("2d");
    if (!g) throw new AttachError(`Couldn't prepare ${file.name}.`);
    g.fillStyle = "#fff";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Read a picked file into an attachment, or throw AttachError with a message for the visitor. */
export async function readAttachment(file: File): Promise<ChatAttachment> {
  const name = file.name.slice(0, 120) || "file";
  if (/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
    const data = await shrinkImage(file);
    if (data.length > CHAT_IMAGE_MAX) throw new AttachError(`${name} is too large, even after shrinking.`);
    return { kind: "image", name, data };
  }
  if (file.type === "application/pdf" || /\.pdf$/i.test(name)) {
    if (file.size > 4 * 1024 * 1024) throw new AttachError(`${name} is larger than 4 MB.`);
    const data = (await readAs(file, "dataUrl")).replace(/^data:[^;]*;/, "data:application/pdf;");
    if (data.length > CHAT_PDF_MAX) throw new AttachError(`${name} is larger than 4 MB.`);
    return { kind: "pdf", name, data };
  }
  if (file.type.startsWith("text/") || TEXT_EXT.test(name) || file.type === "application/json") {
    if (file.size > CHAT_TEXT_FILE_MAX * 4) throw new AttachError(`${name} is too long.`);
    const text = await readAs(file, "text");
    if (!text.trim()) throw new AttachError(`${name} is empty.`);
    if (text.length > CHAT_TEXT_FILE_MAX)
      throw new AttachError(`${name} is too long (max 60,000 characters).`);
    return { kind: "text", name, text };
  }
  throw new AttachError(`${name}: use an image, a PDF or a text file.`);
}

/** Drop file contents before saving a chat in the browser. */
export const forStorage = (list?: Attached[]): Attached[] | undefined =>
  list?.map((a) => ({ kind: a.kind, name: a.name, gone: true as const }));
