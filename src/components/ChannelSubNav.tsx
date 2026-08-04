"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WithTip } from "@/components/HelpTip";

/**
 * The channel tab strip, with an ACTIVE state — the strip used to render every
 * tab identically (muted, hover-only), so nothing told you which tab you were
 * on. Client-side purely for usePathname; the accent underline + colored label
 * mirror how the Blog strip marks its current tab.
 *
 * flex-wrap, not overflow-x-auto — which is why <WithTip> bubbles are safe
 * here while the Blog/Production strips must use native titles.
 */

export type ChannelSubNavItem = { href: string; label: string; tip?: string };

export function ChannelSubNav({
  base,
  accent,
  items,
}: {
  /** "/channels/<id>" — item hrefs are appended to this. */
  base: string;
  accent: string;
  items: ChannelSubNavItem[];
}) {
  const pathname = usePathname() ?? "";
  const isActive = (href: string) =>
    href === "" ? pathname === base : pathname === base + href || pathname.startsWith(base + href + "/");

  return (
    <nav className="flex flex-wrap gap-1 mb-5 border-b border-[var(--line)]">
      {items.map((s) => {
        const on = isActive(s.href);
        return (
          <WithTip key={s.href} text={`${s.label} — ${s.tip ?? ""}`} side="bottom" wide>
            <Link
              href={`${base}${s.href}`}
              aria-current={on ? "page" : undefined}
              className="text-xs font-mono uppercase tracking-wider px-3 py-2 border-b-2 transition-colors"
              style={
                on
                  ? { borderColor: accent, color: accent, fontWeight: 700 }
                  : { borderColor: "transparent", color: "var(--mute)" }
              }
            >
              {s.label}
            </Link>
          </WithTip>
        );
      })}
    </nav>
  );
}
