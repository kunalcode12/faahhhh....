"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

import { ErrorPanel } from "./error-panel";
import { Skeleton } from "./skeleton";

/**
 * The three states every data section has, handled the same way everywhere:
 * first load -> skeleton of the final size; failure -> inline error + retry;
 * data -> render (dimmed while a newer request for different params is in flight).
 */
export function QuerySection<T>({
  query,
  skeletonClassName,
  children,
}: {
  query: UseQueryResult<T>;
  skeletonClassName: string;
  children: (data: T, dimmed: boolean) => ReactNode;
}) {
  if (query.isPending) return <Skeleton className={cn("rounded-3xl", skeletonClassName)} />;
  if (query.isError) {
    return <ErrorPanel error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  }
  return <>{children(query.data, query.isPlaceholderData)}</>;
}
