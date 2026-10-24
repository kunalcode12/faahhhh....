"use client";

import { onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

/**
 * Online status from TanStack Query's own online manager - the same signal it
 * uses to pause queries while offline and resume them on reconnect, so the
 * banner and the data layer always agree.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
    () => true,
  );
}
