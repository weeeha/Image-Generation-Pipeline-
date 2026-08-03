"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LibraryBig, Wand2, SlidersHorizontal, History } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/library", label: "Library", icon: LibraryBig },
  { href: "/generate", label: "Generate", icon: Wand2 },
  { href: "/tokens", label: "Tokens", icon: SlidersHorizontal },
  { href: "/history", label: "History", icon: History },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border px-3 py-5">
      <div className="mb-8 px-2 text-sm font-medium tracking-wide text-foreground">
        Film Design System
      </div>
      <nav className="flex flex-col gap-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                active && "bg-accent text-foreground"
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
