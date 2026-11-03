"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";

export type TabItem = { href: string; label: string; icon: LucideIcon; badge?: number; exact?: boolean };

// Link-based tabs: each tab is its own URL, so it can be bookmarked and the back button works.
// Phones: every tab is visible as wrapping chips (a sideways-scrolling row hid most of them).
// Wider screens: one underlined row.
export function Tabs({ items }: { items: TabItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-2 sm:-mx-1 sm:flex-nowrap sm:gap-1 sm:overflow-x-auto sm:px-1" aria-label="Sections">
      {items.map(({ href, label, icon: Icon, badge, exact }) => {
        const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition sm:rounded-none sm:border-0 sm:border-b-2 sm:py-2.5 ${
              active ? "border-accent bg-accent-soft text-accent sm:bg-transparent" : "border-line text-muted hover:text-ink sm:border-transparent"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
            {!!badge && <span className="rounded-full bg-bad px-1.5 text-[11px] font-semibold text-white">{badge}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
