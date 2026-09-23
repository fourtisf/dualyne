import type { Metadata } from "next";
import { HomePage } from "@/components/HomePage";
import { homeAlternates } from "@/lib/site";

export const revalidate = 60;
export const metadata: Metadata = { alternates: homeAlternates("en") };

export default function Page() {
  return <HomePage locale="en" />;
}
