"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { publicConfig } from "@/lib/config";

/**
 * Tells the API about each page view (POST /internal/pv) so we know how many people use the site.
 * No cookies and nothing stored in the browser. Skipped for "Do Not Track", Global Privacy Control
 * and automated browsers.
 */
export function PageView() {
  const pathname = usePathname();
  const first = useRef(true);

  useEffect(() => {
    if (!publicConfig.apiUrl || !pathname) return;
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (nav.doNotTrack === "1" || nav.globalPrivacyControl || nav.webdriver) return;
    // Only the first page view carries the referrer; later ones are navigation inside the site.
    const ref = first.current ? document.referrer : "";
    first.current = false;
    void fetch(`${publicConfig.apiUrl.replace(/\/$/, "")}/internal/pv`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ref ? { path: pathname, ref } : { path: pathname }),
      keepalive: true,
    }).catch(() => undefined);
  }, [pathname]);

  return null;
}
