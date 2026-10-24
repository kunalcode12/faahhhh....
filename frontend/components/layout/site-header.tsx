import Link from "next/link";

import { Logo } from "./logo";
import { NavLinks } from "./nav-links";
import { FetchProgress } from "./status";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-page/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 rounded-xl">
          <Logo />
          {/* On narrow phones the mark alone carries the brand; the name stays for screen readers. */}
          <span className="text-xl font-black tracking-tight max-[459px]:sr-only">Beaufort</span>
          <span className="hidden text-sm font-medium text-muted md:inline">Day-ahead wind desk</span>
        </Link>
        <NavLinks />
      </div>
      <FetchProgress />
    </header>
  );
}
