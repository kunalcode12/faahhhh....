/** Three wind strokes of decreasing length - a nod to the Beaufort scale. */
export function Logo({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="currentColor" />
      <g stroke="var(--page)" strokeWidth="3" strokeLinecap="round">
        <path d="M8 11h16" />
        <path d="M8 16.5h11" />
        <path d="M8 22h6" />
      </g>
    </svg>
  );
}
