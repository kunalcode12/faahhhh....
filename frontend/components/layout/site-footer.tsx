export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-8 text-sm text-ink-2 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p>
          Data: Elexon Insights API (BMRS) &middot; FUELHH wind outturn &middot; WINDFOR wind
          forecast. All times UK local.
        </p>
        <p>
          {/* A plain link on purpose: Swagger UI is served by the FastAPI backend, not Next.js. */}
          <a
            href="/api/docs"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-ink underline-offset-4 hover:underline"
          >
            API docs
          </a>
        </p>
      </div>
    </footer>
  );
}
