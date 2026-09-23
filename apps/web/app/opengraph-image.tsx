import { brand } from "@refract/config";
import { ogImage, ogSize } from "@/lib/og";

export const alt = `${brand.name}: ${brand.tagline}`;
export const size = ogSize;
export const contentType = "image/png";

export default async function OpengraphImage() {
  return ogImage("en");
}
