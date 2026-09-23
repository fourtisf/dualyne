/** The prism logo. `defs` is rendered once (in the nav); the footer copy reuses the #lg gradient. */
export function Logo({ defs = false }: { defs?: boolean }) {
  return (
    <svg className="logo" viewBox="0 0 24 24" aria-hidden="true">
      {defs && (
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#67E8F9" />
            <stop offset=".5" stopColor="#8B5CF6" />
            <stop offset="1" stopColor="#F472B6" />
          </linearGradient>
        </defs>
      )}
      <path d="M12 2.5 21.5 20h-19Z" fill="none" stroke="url(#lg)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 9.5 16 17H8Z" fill="url(#lg)" opacity=".85" />
    </svg>
  );
}
