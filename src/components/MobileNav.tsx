"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Menu, X, LogOut, User,
  Home, Layers, Telescope, Sparkles, PenLine, MessageCircle, Image as ImageIcon, KanbanSquare, Settings, HelpCircle,
} from "lucide-react";
import { isNavActive, type LeftRailItem } from "@/components/LeftRailNav";

// Mobile slide-in drawer that mirrors the desktop left rail, but with visible
// labels (icon-only nav is fine on hover-capable desktop, not on touch).
// Shown only below md; the desktop rail is hidden there.

const ICONS = {
  Home, Layers, Telescope, Sparkles, PenLine, MessageCircle, ImageIcon, KanbanSquare, Settings, HelpCircle,
} as const;

export function MobileNav({
  items,
  userLabel,
  signOutAction,
}: {
  items: LeftRailItem[];
  userLabel: string;
  signOutAction: () => void;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={open}
        className="w-11 h-11 rounded-xl grid place-items-center text-[var(--slate)] hover:bg-[var(--zebra)] -ml-2"
      >
        <Menu className="w-5 h-5" strokeWidth={2.25} />
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <nav className="absolute left-0 top-0 bottom-0 w-72 max-w-[80vw] bg-[var(--bg)] border-r border-[var(--line)] flex flex-col p-3 shadow-2xl">
            <div className="flex items-center gap-2 px-1 mb-3">
              <span
                className="w-9 h-9 rounded-xl text-white grid place-items-center font-mono font-bold"
                style={{ background: "linear-gradient(150deg,#F0623F,#C53A22)" }}
                aria-hidden
              >
                ▲
              </span>
              <span className="font-mono font-bold text-[15px]">CreateUp</span>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="w-11 h-11 rounded-xl grid place-items-center text-[var(--mute)] hover:bg-[var(--zebra)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-col gap-1 overflow-y-auto">
              {items.map((n) => {
                const Icon = ICONS[n.icon];
                const isActive = isNavActive(n.href, pathname);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    onClick={() => setOpen(false)}
                    aria-current={isActive ? "page" : undefined}
                    className="flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-semibold min-h-[44px]"
                    style={{
                      background: isActive ? n.color : n.soft,
                      color: isActive ? "#ffffff" : n.color,
                    }}
                  >
                    <Icon className="w-5 h-5" strokeWidth={2.25} />
                    {n.label}
                  </Link>
                );
              })}
            </div>

            <div className="mt-auto pt-3 border-t border-[var(--line)] flex flex-col gap-1">
              <Link
                href="/settings"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-semibold min-h-[44px] text-[var(--slate)] hover:bg-[var(--zebra)]"
              >
                <User className="w-5 h-5" strokeWidth={2.25} /> {userLabel} · Settings
              </Link>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-semibold min-h-[44px] text-[var(--mute)] hover:text-[var(--brand)] hover:bg-[var(--brand-soft)]"
                >
                  <LogOut className="w-5 h-5" strokeWidth={2.25} /> Sign out
                </button>
              </form>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
