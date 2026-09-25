import type { Metadata } from "next";
import { PassView } from "@/components/PassView";

export const metadata: Metadata = {
  title: "Dualyne Pass",
  description:
    "An NFT membership: while a Dualyne Pass is in your wallet, you have Dualyne Pro, every AI model in Chat.",
  alternates: { canonical: "/pass" },
};

export default function Page() {
  return <PassView />;
}
