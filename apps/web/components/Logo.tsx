/**
 * The "prompt lines" mark: a prompt caret and two answer lines (one prompt, two answers).
 * The caret follows the text colour; the lines use the brand cyan and pink.
 */
export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 100 100" aria-hidden="true">
      <path
        d="M18 26 L42 50 L18 74"
        fill="none"
        stroke="currentColor"
        strokeWidth="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="52" y="56" width="34" height="9" rx="4.5" fill="#67E8F9" />
      <rect x="52" y="71" width="24" height="9" rx="4.5" fill="#F472B6" />
    </svg>
  );
}
