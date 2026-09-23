"use client";

import { ErrorView } from "@/components/ErrorView";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return <ErrorView reset={reset} />;
}
