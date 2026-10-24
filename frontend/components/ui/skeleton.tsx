import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/** Placeholder block with a shimmer; sized by the caller to match the real content. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton rounded-xl", className)} />;
}

/** Announces loading to screen readers once, without reading every placeholder. */
export function LoadingRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
