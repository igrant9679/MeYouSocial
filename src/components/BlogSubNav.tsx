"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The Blog workspace sub-nav: sticky tab strip with live count badges and a
 * sliding rose underline. Client-side only for active-route highlighting —
 * the counts arrive from the server layout.
 *
 * With 11 tabs the strip overflows on narrow/zoomed screens; the scrollbar is
 * hidden, so edge fades signal the hidden tabs. The fades track real scroll
 * state (none at the reachable end) — a permanent fade would lie.
 */

export type BlogNavItem = {
  href: string;
  label: string;
  count?: number;
  /** true = counts something needing attention (rose badge); false = neutral. */
  urgent?: boolean;
};

export function BlogSubNav({ items }: { items: BlogNavItem[] }) {
  const pathname = usePathname() ?? "";
  const scroller = useRef<HTMLElement>(null);
  const [fade, setFade] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      setFade({ left: el.scrollLeft > 4, right: el.scrollLeft < max - 4 });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  // Bring the active tab into view on load — otherwise a tab hidden in the
  // overflow gives no clue you're on it.
  useEffect(() => {
    const el = scroller.current;
    const active = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (el && active) {
      const target = active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2;
      el.scrollTo({ left: Math.max(0, target) });
    }
  }, [pathname]);

  const isActive = (href: string) =>
    href === "/blog" ? pathname === "/blog" || /^\/blog\/(?!ideas|keywords|experts|audit|analytics|report|automation|brand|organization|settings|board|calendar)[^/]+/.test(pathname) : pathname === href || pathname.startsWith(href + "/");

  return (
    <div className="relative bg-[var(--bg)] border-b border-[var(--line)]">
      <nav
        ref={scroller}
        aria-label="Blog sections"
        className="flex items-center gap-0.5 overflow-x-auto px-4"
        style={{ scrollbarWidth: "none" }}
      >
        {items.map((it) => {
          const on = isActive(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={on ? "page" : undefined}
              className="group relative inline-flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-semibold whitespace-nowrap transition-colors"
              style={{ color: on ? "var(--rose)" : "var(--slate)" }}
            >
              {it.label}
              {typeof it.count === "number" && it.count > 0 && (
                <span
                  className="font-mono text-[9.5px] font-bold rounded-full px-1.5 py-px"
                  style={
                    it.urgent
                      ? { background: "var(--rose-soft)", color: "var(--rose-on)" }
                      : { background: "var(--panel)", color: "var(--mute)" }
                  }
                >
                  {it.count}
                </span>
              )}
              <span
                aria-hidden
                className="absolute left-2 right-2 bottom-0 h-[3px] rounded-t transition-transform duration-200 ease-out origin-center group-hover:scale-x-100"
                style={{ background: "var(--rose)", transform: on ? "scaleX(1)" : "scaleX(0)" }}
              />
            </Link>
          );
        })}
      </nav>
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 bottom-0 w-8 transition-opacity duration-150"
        style={{ background: "linear-gradient(to right, var(--bg), transparent)", opacity: fade.left ? 1 : 0 }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 transition-opacity duration-150"
        style={{ background: "linear-gradient(to left, var(--bg), transparent)", opacity: fade.right ? 1 : 0 }}
      />
    </div>
  );
}
