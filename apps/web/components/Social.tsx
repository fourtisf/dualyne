import { brand } from "@dualyne/config";
import { getDict, type Locale } from "@/lib/i18n";

/** Brand icons for the community links. */
export const socialIcons = {
  x: (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8Zm-1.1 16.2h1.7L7.4 4.7H5.6Z"
      />
    </svg>
  ),
  telegram: (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21.4 4.3 2.9 11.4c-1.3.5-1.2 1.2-.2 1.5l4.7 1.5 1.8 5.6c.2.6.4.8.9.8.4 0 .6-.2.9-.5l2.3-2.2 4.7 3.5c.9.5 1.5.2 1.7-.8l3.1-14.5c.3-1.3-.5-1.8-1.4-1.5ZM8.9 14.2l9.3-5.9c.4-.3.8-.1.5.2l-7.6 6.9-.3 3.3Z"
      />
    </svg>
  ),
  github: (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.4-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.2-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.5.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9V21c0 .3.2.6.7.5A10 10 0 0 0 12 2Z"
      />
    </svg>
  ),
};
export const socialLabel = { x: "X", telegram: "Telegram", github: "GitHub" } as const;

/**
 * X and Telegram always show: as links once their URLs are set, as "coming soon" until then.
 * GitHub shows only when it has a link. Placeholder "#" links are never rendered.
 */
export function SocialLinks({ locale }: { locale: Locale }) {
  const t = getDict(locale).footer;
  const keys = (["x", "telegram", "github"] as const).filter((k) => k !== "github" || brand.social[k]);
  return (
    <div className="social">
      {keys.map((k) =>
        brand.social[k] ? (
          <a key={k} href={brand.social[k]} aria-label={t.on(socialLabel[k])} target="_blank" rel="noopener">
            {socialIcons[k]}
          </a>
        ) : (
          <span
            key={k}
            className="soon"
            role="img"
            aria-label={t.soon(socialLabel[k])}
            title={t.soon(socialLabel[k])}
          >
            {socialIcons[k]}
          </span>
        ),
      )}
    </div>
  );
}
