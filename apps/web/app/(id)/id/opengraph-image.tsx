import { brand } from "@refract/config";
import { getDict } from "@/lib/i18n";
import { ogImage, ogSize } from "@/lib/og";

export const alt = `${brand.name}: ${getDict("id").meta.tagline}`;
export const size = ogSize;
export const contentType = "image/png";

export default async function OpengraphImage() {
  return ogImage("id");
}
