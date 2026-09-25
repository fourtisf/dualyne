import { brand } from "@dualyne/config";
import { getCatalog } from "@/lib/catalog";
import { ogImage, ogSize, shareCardImage } from "@/lib/og";
import { excerpt, getSharedCompare } from "@/lib/shares";

export const alt = `A comparison shared from ${brand.name}`;
export const size = ogSize;
export const contentType = "image/png";

/** Preview card for a shared comparison: the prompt and the start of both answers. */
export default async function Image({ params }: { params: { id: string } }) {
  const s = await getSharedCompare(params.id);
  if (!s) return ogImage("en");
  const { models } = await getCatalog();
  const name = (id: string) => models.find((m) => m.id === id)?.name ?? id;
  return shareCardImage({
    kicker: "Compare",
    question: excerpt(s.prompt, 110),
    panels: [
      { name: name(s.a), text: excerpt(s.answerA, 150) },
      { name: name(s.b), text: excerpt(s.answerB, 150) },
    ],
  });
}
