"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SOCIAL_TAB_TIPS } from "@/lib/help-tips";

/**
 * The Social workspace sub-nav — the same sticky strip the Blog side uses,
 * in social's purple. Client-side only for active-route highlighting; the
 * counts are computed in the server layout.
 *
 * Overview is the command centre, so its badge is the ATTENTION count (things
 * asking for a decision), not a total. A neutral total there would read as
 * "12 posts exist", which nobody needs to know at a glance.
 */

export type SocialNavItem = {
  href: string;
  label: string;
  count?: number;
  /** true = counts something needing attention (rose badge); false = neutral. */
  urgent?: boolean;
};

export function SocialSubNav({ items }: { items: SocialNavItem[] }) {
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

  // "/social" must not light up for every child route, and the post editor
  // (/social/<id>/edit) belongs to no tab — it's reached from a card.
  const isActive = (href: string) =>
    href === "/social" ? pathname === "/social" : pathname === href || pathname.startsWith(href + "/");

  return (
    <div className="relative bg-[var(--bg)] border-b border-[var(--line)]">
      <nav
        ref={scroller}
        aria-label="Social sections"
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
              // Native title rather than a HelpTip bubble: this strip is
              // overflow-x-auto, which clips absolutely-positioned children.
              title={SOCIAL_TAB_TIPS[it.href]}
              className="group relative inline-flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-semibold whitespace-nowrap transition-colors"
              style={{ color: on ? "var(--purple)" : "var(--slate)" }}
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
                style={{ background: "var(--purple)", transform: on ? "scaleX(1)" : "scaleX(0)" }}
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
