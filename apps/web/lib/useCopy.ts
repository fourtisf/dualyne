"use client";

import { useState } from "react";

/** Copy text to the clipboard; the state drives the button label (Copy / Copied / Select to copy). */
export function useCopy() {
  const [state, setState] = useState<"copy" | "copied" | "select">("copy");
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("select");
    }
    setTimeout(() => setState("copy"), 1600);
  };
  return { state, copy };
}
