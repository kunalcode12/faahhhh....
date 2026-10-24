"use client";

import { catchError, type ErrorInfo } from "next/error";

import { ErrorPanel } from "./error-panel";

function SectionFallback(_props: object, { error, retry }: ErrorInfo) {
  return <ErrorPanel error={error} onRetry={retry} />;
}

/**
 * Component-level error boundary (Next's `catchError`). Wrap each independent
 * section so a rendering bug in one chart degrades to an inline error with a
 * retry button instead of taking the whole page down.
 */
export const SectionBoundary = catchError(SectionFallback);
