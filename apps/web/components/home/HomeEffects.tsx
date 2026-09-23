"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Small behaviours from the prototype that don't need React state:
 * tile spotlight that follows the pointer, count-up of the ledger KPIs,
 * and redirects for old hash routes (/#/docs, /#/dashboard).
 */
export function HomeEffects() {
  const router = useRouter();

  useEffect(() => {
    const h = window.location.hash;
    if (h === "#/docs") router.replace("/docs");
    else if (h === "#/dashboard") router.replace("/dashboard");
  }, [router]);

  useEffect(() => {
    const tiles = Array.from(document.querySelectorAll<HTMLElement>(".tile"));
    const onMove = (e: PointerEvent) => {
      const t = e.currentTarget as HTMLElement;
      const r = t.getBoundingClientRect();
      t.style.setProperty("--mx", `${e.clientX - r.left}px`);
      t.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    tiles.forEach((t) => t.addEventListener("pointermove", onMove));
    return () => tiles.forEach((t) => t.removeEventListener("pointermove", onMove));
  }, []);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !("IntersectionObserver" in window)) return;
    const raf: number[] = [];
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          io.unobserve(en.target);
          const el = en.target as HTMLElement;
          const raw = el.textContent ?? "";
          const m = raw.match(/[\d,]+/);
          if (!m || m.index === undefined) return;
          const target = parseInt(m[0].replace(/,/g, ""), 10);
          const pre = raw.slice(0, m.index);
          const post = raw.slice(m.index + m[0].length);
          const t0 = performance.now();
          const dur = 1400;
          const step = (now: number) => {
            const k = Math.min(1, (now - t0) / dur);
            const e = 1 - Math.pow(1 - k, 3);
            el.textContent = pre + Math.round(target * e).toLocaleString("en-US") + post;
            if (k < 1) raf.push(requestAnimationFrame(step));
          };
          raf.push(requestAnimationFrame(step));
        }),
      { threshold: 0.6 },
    );
    document.querySelectorAll(".kpi .v").forEach((v) => io.observe(v));
    return () => {
      io.disconnect();
      raf.forEach(cancelAnimationFrame);
    };
  }, []);

  return null;
}
