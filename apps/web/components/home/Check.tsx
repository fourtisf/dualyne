/** The prototype's check-mark icon, used in lists. */
export function Check({
  size = 14,
  color = "currentColor",
  width = 1.8,
}: {
  size?: number;
  color?: string;
  width?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 8.5 6.5 12 13 4.5"
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
