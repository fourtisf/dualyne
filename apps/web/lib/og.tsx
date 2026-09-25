import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { brand } from "@dualyne/config";
import { getDict, type Locale } from "./i18n";

export const ogSize = { width: 1200, height: 630 };

/** Geist faces from the geist package. The card is rendered at build time, where node_modules is present. */
const font = (file: string) => readFile(path.join(process.cwd(), "node_modules/geist/dist/fonts", file));

/** Social preview card (1200×630), generated at build time. */
export async function ogImage(locale: Locale) {
  const t = getDict(locale);
  const [regular, bold, mono] = await Promise.all([
    font("geist-sans/Geist-Regular.ttf"),
    font("geist-sans/Geist-Bold.ttf"),
    font("geist-mono/GeistMono-Medium.ttf"),
  ]);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 96px",
          background:
            "radial-gradient(circle at 50% 0%, rgba(139,92,246,0.45) 0%, rgba(96,165,250,0.10) 35%, #050507 70%)",
          backgroundColor: "#050507",
          color: "#EDEDEF",
          fontFamily: "Geist",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 40, fontWeight: 500 }}>
          <svg width="64" height="64" viewBox="0 0 100 100">
            <path
              d="M18 26 L42 50 L18 74"
              fill="none"
              stroke="#EDEDEF"
              strokeWidth="10"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect x="52" y="56" width="34" height="9" rx="4.5" fill="#67E8F9" />
            <rect x="52" y="71" width="24" height="9" rx="4.5" fill="#F472B6" />
          </svg>
          <span style={{ fontFamily: "Geist Mono", letterSpacing: "-0.01em" }}>
            {brand.name.toLowerCase()}
          </span>
        </div>
        <div
          style={{ fontSize: 84, fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1.02, marginTop: 40 }}
        >
          {t.hero.h1a}
        </div>
        <div style={{ fontSize: 84, fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1.02 }}>
          {t.hero.h1b}
        </div>
        <div style={{ fontSize: 30, color: "#8A8A94", marginTop: 34 }}>{t.meta.ogLine}</div>
      </div>
    ),
    {
      ...ogSize,
      fonts: [
        { name: "Geist", data: regular, weight: 400, style: "normal" },
        { name: "Geist", data: bold, weight: 700, style: "normal" },
        { name: "Geist Mono", data: mono, weight: 500, style: "normal" },
      ],
    },
  );
}

const LOGO = (
  <svg width="44" height="44" viewBox="0 0 100 100">
    <path
      d="M18 26 L42 50 L18 74"
      fill="none"
      stroke="#EDEDEF"
      strokeWidth="10"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <rect x="52" y="56" width="34" height="9" rx="4.5" fill="#67E8F9" />
    <rect x="52" y="71" width="24" height="9" rx="4.5" fill="#F472B6" />
  </svg>
);

interface Panel {
  name: string;
  text: string;
  /** Highlighted (the answer that won, or the one shown). */
  on?: boolean;
}

/** Preview card for a shared comparison or chat: the question, then one or two answers. */
export async function shareCardImage(opts: { kicker: string; question: string; panels: Panel[] }) {
  const [regular, bold, mono] = await Promise.all([
    font("geist-sans/Geist-Regular.ttf"),
    font("geist-sans/Geist-Bold.ttf"),
    font("geist-mono/GeistMono-Medium.ttf"),
  ]);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "52px 64px",
          background:
            "radial-gradient(circle at 80% 0%, rgba(139,92,246,0.40) 0%, rgba(96,165,250,0.08) 35%, #050507 70%)",
          backgroundColor: "#050507",
          color: "#EDEDEF",
          fontFamily: "Geist",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {LOGO}
          <span style={{ fontFamily: "Geist Mono", fontSize: 28 }}>{brand.name.toLowerCase()}</span>
          <span
            style={{
              marginLeft: "auto",
              fontFamily: "Geist Mono",
              fontSize: 18,
              letterSpacing: "0.14em",
              color: "#A1A1AA",
              textTransform: "uppercase",
            }}
          >
            {opts.kicker}
          </span>
        </div>
        <div
          style={{
            marginTop: 34,
            fontSize: 44,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1.12,
            display: "flex",
          }}
        >
          “{opts.question}”
        </div>
        <div style={{ display: "flex", gap: 20, marginTop: "auto" }}>
          {opts.panels.map((p) => (
            <div
              key={p.name}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 12,
                padding: "22px 24px",
                borderRadius: 20,
                background: p.on ? "rgba(139,92,246,0.16)" : "rgba(255,255,255,0.05)",
                border: p.on ? "2px solid rgba(167,139,250,0.8)" : "2px solid rgba(255,255,255,0.10)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 24, fontWeight: 700 }}>
                {p.name}
                {p.on && opts.panels.length > 1 && (
                  <span style={{ fontSize: 16, color: "#C4B5FD", fontFamily: "Geist Mono" }}>WINNER</span>
                )}
              </div>
              <div style={{ fontSize: 22, lineHeight: 1.4, color: "#C9C9D2", display: "flex" }}>{p.text}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    {
      ...ogSize,
      fonts: [
        { name: "Geist", data: regular, weight: 400, style: "normal" },
        { name: "Geist", data: bold, weight: 700, style: "normal" },
        { name: "Geist Mono", data: mono, weight: 500, style: "normal" },
      ],
    },
  );
}
