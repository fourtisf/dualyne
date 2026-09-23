import { ImageResponse } from "next/og";
import { brand } from "@refract/config";
import { getDict, type Locale } from "./i18n";

export const ogSize = { width: 1200, height: 630 };

/** Social preview card (1200×630), generated at build time. */
export function ogImage(locale: Locale) {
  const t = getDict(locale);
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
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 40, fontWeight: 600 }}>
          <svg width="56" height="56" viewBox="0 0 24 24">
            <defs>
              <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#67E8F9" />
                <stop offset=".5" stopColor="#8B5CF6" />
                <stop offset="1" stopColor="#F472B6" />
              </linearGradient>
            </defs>
            <path
              d="M12 2.5 21.5 20h-19Z"
              fill="none"
              stroke="url(#g)"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path d="M12 9.5 16 17H8Z" fill="url(#g)" opacity=".85" />
          </svg>
          {brand.name}
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
    ogSize,
  );
}
