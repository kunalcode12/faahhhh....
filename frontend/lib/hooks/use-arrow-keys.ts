"use client";

import { useEffect, useRef } from "react";

/** Left/right arrow shortcuts, ignored while typing in a form field. */
export function useArrowKeys(onLeft: () => void, onRight: () => void): void {
  const handlers = useRef({ onLeft, onRight });
  useEffect(() => {
    handlers.current = { onLeft, onRight };
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='radiogroup']")) return;
      if (event.key === "ArrowLeft") handlers.current.onLeft();
      if (event.key === "ArrowRight") handlers.current.onRight();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
