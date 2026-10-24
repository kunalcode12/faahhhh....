"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/** Route-level safety net: anything that escapes the per-section boundaries lands here. */
export default function RouteError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest = error instanceof Error && "digest" in error ? String(error.digest) : null;

  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <p className="text-sm font-semibold text-ink-2">Something broke</p>
      <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-5xl">This page hit an error</h1>
      <p className="mt-4 text-ink-2">
        It&apos;s on our side, not yours. Trying again usually fixes it; if it doesn&apos;t, the
        reference below helps us find the cause.
      </p>
      <div className="mt-8 flex items-center justify-center gap-3">
        <Button onClick={() => retry()}>Try again</Button>
        <Link
          href="/"
          className="inline-flex h-10 items-center rounded-xl border border-line bg-surface px-4 text-sm font-bold text-ink hover:bg-surface-2"
        >
          Back to the desk
        </Link>
      </div>
      {digest ? <p className="mt-6 text-xs text-muted">Reference {digest}</p> : null}
    </div>
  );
}
