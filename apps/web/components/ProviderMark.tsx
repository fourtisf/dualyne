import type { CSSProperties } from "react";

/** Logo files in public/providers (from @lobehub/icons, MIT). */
const LOGOS: Record<string, string> = {
  Anthropic: "anthropic",
  OpenAI: "openai",
  Google: "google",
  Meta: "meta",
  DeepSeek: "deepseek",
  Mistral: "mistral",
};

/** The model maker's logo on a light tile; a tile in the provider's colour when there's no logo. */
export function ProviderMark({
  provider,
  color,
  size = 22,
}: {
  provider: string;
  color: string;
  size?: number;
}) {
  const logo = LOGOS[provider];
  const style = { "--c": color, "--s": `${size}px` } as CSSProperties;
  return (
    <span className={logo ? "pmark" : "pmark none"} style={style} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny local SVG */}
      {logo && <img src={`/providers/${logo}.svg`} alt="" width={size} height={size} />}
    </span>
  );
}
