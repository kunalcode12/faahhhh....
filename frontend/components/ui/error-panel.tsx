"use client";

import { describeError } from "@/lib/api/errors";
import { cn } from "@/lib/cn";

import { Button } from "./button";

function AlertIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-6 shrink-0 text-critical" fill="none">
      <path
        d="M12 3.5 2.8 19.5h18.4L12 3.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M12 10v4.5M12 17v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Inline failure state for one section, so a single failed request never
 * blanks the whole page. Shows friendly copy, a retry button and the request
 * id a support engineer can grep the backend logs for.
 */
export function ErrorPanel({
  error,
  onRetry,
  retrying = false,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  const { title, message, requestId } = describeError(error);
  return (
    <div role="alert" className={cn("rounded-3xl border border-line bg-surface p-6", className)}>
      <div className="flex gap-3">
        <AlertIcon />
        <div>
          <p className="text-lg font-extrabold">{title}</p>
          <p className="mt-1 max-w-prose text-ink-2">{message}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {onRetry ? (
              <Button onClick={onRetry} disabled={retrying}>
                {retrying ? "Retrying…" : "Try again"}
              </Button>
            ) : null}
            {requestId ? (
              <span className="text-xs text-muted">
                Reference <code className="font-mono">{requestId.slice(0, 12)}</code>
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
