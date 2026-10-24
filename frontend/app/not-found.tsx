import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <p className="text-sm font-semibold text-ink-2">404</p>
      <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-5xl">Nothing blowing here</h1>
      <p className="mt-4 text-ink-2">That page doesn&apos;t exist.</p>
      <Link
        href="/"
        className="mt-8 inline-flex h-10 items-center rounded-xl bg-ink px-4 text-sm font-bold text-page"
      >
        Back to the desk
      </Link>
    </div>
  );
}
