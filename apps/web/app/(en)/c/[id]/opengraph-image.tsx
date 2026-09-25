import { brand } from "@dualyne/config";
import { getCatalog } from "@/lib/catalog";
import { ogImage, ogSize, shareCardImage } from "@/lib/og";
import { excerpt, getSharedChat } from "@/lib/shares";

export const alt = `A chat shared from ${brand.name}`;
export const size = ogSize;
export const contentType = "image/png";

/** Preview card for a shared chat: the first question and the start of its answer. */
export default async function Image({ params }: { params: { id: string } }) {
  const c = await getSharedChat(params.id);
  if (!c) return ogImage("en");
  const { models } = await getCatalog();
  const model = models.find((m) => m.id === c.model);
  return shareCardImage({
    kicker: "Shared chat",
    question: excerpt(c.messages[0]?.content ?? c.title, 110),
    panels: [{ name: model?.name ?? c.model, text: excerpt(c.messages[1]?.content ?? "", 260), on: true }],
  });
}
