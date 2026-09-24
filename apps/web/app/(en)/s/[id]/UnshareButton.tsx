"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { publicConfig } from "@/lib/config";
import { store } from "@/lib/storage";

/**
 * Shown only in the browser that created the link (it holds the delete token). Used for shared
 * comparisons (/s) and, with `api` and `storeKey`, for shared chats (/c).
 */
export function UnshareButton({
  id,
  api = "/shares/",
  storeKey = "dualyne.shares",
}: {
  id: string;
  api?: string;
  storeKey?: string;
}) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "confirm" | "busy" | "error">("idle");

  useEffect(() => {
    setToken(store.get<Record<string, string>>(storeKey, {})[id] ?? null);
  }, [id, storeKey]);

  if (!token) return null;

  const remove = async () => {
    if (state !== "confirm") {
      setState("confirm");
      return;
    }
    setState("busy");
    try {
      const res = await fetch(`${publicConfig.apiUrl}${api}${id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok && res.status !== 404) throw new Error();
      const all = store.get<Record<string, string>>(storeKey, {});
      delete all[id];
      store.set(storeKey, all);
      router.replace("/");
    } catch {
      setState("error");
    }
  };

  return (
    <button className="btn dark lg" type="button" onClick={remove} disabled={state === "busy"}>
      {state === "confirm"
        ? "Confirm: remove link"
        : state === "error"
          ? "Couldn't remove. Try again"
          : "Remove this link"}
    </button>
  );
}
