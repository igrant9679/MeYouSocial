"use client";

import { useState, useSyncExternalStore, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { STAGES, currentTab, stageFor } from "@/lib/stages";
import type { StripCounts } from "@/lib/stage-counts";
import { noShellSnapshot, shellSnapshot, subscribeShell } from "@/lib/shell-live";
import type { Role } from "@prisma/client";
import { canFollow } from "@/lib/role-links";

/** Each stage's Help section, for the strip's "?" (E-SHL-11). */
const HELP_FOR: Record<string, string> = {
  "/research": "intel", "/ideas": "blog", "/drafts": "writing", "/publish": "publishing",
  "/distribute": "social", "/measure": "insights", "/brand": "brand", "/setup": "team-admin",
};

/** Tabs shown inline at laptop widths before the rest fold into More (E-SHL-13). */
const INLINE = 6;

/**
 * The persistent stage strip — mounted once in the app shell, so every page a
 * stage owns shows the same bar: the stage's Overview, then its tabs, with the
 * current one lit. It is what makes "click a tab, keep the tabs" true; before,
 * the tabs lived on the overview page only and each module page brought its
 * own unrelated bar (the owner: "I'm either lost with no way back or taken to
 * a completely different navigation").
 *
 * Count badges (lib/stage-counts.ts) sit after a tab's label when there is
 * something to count — red when a person has to act, muted when it is news.
 *
 * Renders nothing outside a stage (Inbox, Assistant, Setup, Help). Client-side
 * purely for usePathname; the stage data itself is plain and shared.
 */
export function StageStrip({
  activeChannelId,
  studio,
  counts: serverCounts,
  admin,
  operator,
  role,
}: {
  activeChannelId: string | null;
  studio: boolean;
  counts: StripCounts;
  /** Both decided on the SERVER (app/(app)/layout.tsx) so the client never
   *  guesses at a role. Cosmetic only — every admin page keeps its own gate. */
  admin: boolean;
  operator: boolean;
  /** Tabs this role can't open (Compose, Calendar, Engage… for a viewer) are left out (SHL-07). */
  role: Role;
}) {
  const pathname = usePathname() ?? "";
  // Badges follow the shell poll (E-SHL-01) — they were the layout's, frozen until it re-rendered.
  const live = useSyncExternalStore(subscribeShell, shellSnapshot, noShellSnapshot);
  // The tab just clicked lights AT ONCE (tracker #12): the path only changes
  // when the next page arrives, and a heavy one (Engage) left the old tab lit
  // for seconds, as if the click hadn't landed. Kept only while the path is
  // the one it was clicked from, so it can never outlive the navigation.
  const [clicked, setClicked] = useState<{ href: string; from: string } | null>(null);
  const counts = live?.counts ?? serverCounts;
  const key = stageFor(pathname);
  if (!key) return null;
  const stage = STAGES[key];
  const tabs = stage.tabs({ channelId: activeChannelId, studio, admin, operator }).filter((t) => canFollow(t.href, role));
  // A tab on this same path (the one you're on, or a ?query variant) is never "pending".
  const pendingHref = clicked && clicked.from === pathname && clicked.href.split("?")[0] !== pathname ? clicked.href : null;
  // A page no tab owns (an idea's or a post's own page) lights Overview, so the
  // strip always says where you are (tracker #2) — it used to light nothing.
  const matched = pendingHref || pathname === stage.href ? null : currentTab(pathname, tabs);
  const onOverview = pendingHref ? pendingHref === stage.href : pathname === stage.href || !matched;
  const current = pendingHref ? tabs.find((t) => t.href === pendingHref) ?? null : matched;
  // A plain left click only — a new tab or window leaves this page where it is.
  const press = (href: string) => (e: MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    setClicked({ href, from: pathname });
  };

  const badge = (href: string) => {
    const c = counts[href.split("?")[0]];
    if (!c || c.n <= 0) return null;
    return (
      <span
        className="font-mono text-micro font-bold px-1.5 py-px rounded-full leading-4 tabular-nums"
        style={c.urgent ? { background: "var(--rose-soft)", color: "var(--rose-on)" } : { background: "var(--zebra)", color: "var(--mute)" }}
        title={c.urgent ? `${c.n} waiting on a person` : `${c.n}`}
      >
        {c.n}
      </span>
    );
  };

  // Distribute has nine tabs and Settings more; at laptop widths they wrapped onto a second row.
  const overflow = tabs.length > INLINE + 1;
  const folded = overflow ? tabs.slice(INLINE).filter((t) => t.href !== current?.href) : [];
  const moreBadge = folded.reduce((n, t) => n + (counts[t.href.split("?")[0]]?.n ?? 0), 0);
  const moreUrgent = folded.some((t) => counts[t.href.split("?")[0]]?.urgent);

  const linkClass = "text-2xs font-semibold px-2.5 py-2 border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5";
  const lit = { borderColor: "var(--accent)", color: "var(--accent-on)" };
  const dim = { borderColor: "transparent", color: "var(--mute)" };

  return (
    <nav
      aria-label={`${stage.label} pages`}
      className="sticky top-0 z-30 -mx-6 -mt-6 mb-5 px-6 flex items-center gap-1 flex-wrap max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:whitespace-nowrap border-b border-[var(--line)] bg-[var(--panel)]"
    >
      <span className="font-mono text-micro font-bold uppercase tracking-wider text-[var(--mute)] pr-2 py-2">{stage.label}</span>
      <Link href={stage.href} aria-current={pathname === stage.href && !pendingHref ? "page" : undefined} className={linkClass} style={onOverview ? lit : dim} onClick={press(stage.href)} data-pending={onOverview && pendingHref ? "" : undefined}>
        Overview{badge(stage.href)}
      </Link>
      {tabs.map((t, i) => {
        const on = current?.href === t.href;
        // Past INLINE, a tab folds into More between phone and wide widths (E-SHL-13) —
        // never the one you're on. Phones keep the scrolling row.
        const folds = overflow && i >= INLINE && !on;
        return (
          <Link key={t.href} href={t.href} aria-current={on && !pendingHref ? "page" : undefined} className={`${linkClass} hover:text-[var(--ink)]${folds ? " sm:hidden xl:inline-flex" : ""}`} style={on ? lit : dim} onClick={press(t.href)} data-pending={on && pendingHref ? "" : undefined}>
            {t.label}{badge(t.href)}
          </Link>
        );
      })}
      {overflow && (
        // Keyed on the clicked tab too, so picking one from More closes the menu at once.
        <details key={`${pathname}|${pendingHref ?? ""}`} className="relative hidden sm:block xl:hidden" data-strip-more>
          <summary className={`${linkClass} cursor-pointer list-none`} style={dim}>
            More ▾{moreBadge > 0 && <span className="font-mono text-micro font-bold px-1.5 py-px rounded-full leading-4" style={{ background: moreUrgent ? "var(--rose-soft)" : "var(--zebra)", color: moreUrgent ? "var(--rose-on)" : "var(--mute)" }}>{moreBadge}</span>}
          </summary>
          <div className="absolute right-0 top-full mt-1 z-40 min-w-44 rounded-lg border border-[var(--line)] bg-[var(--panel)] shadow-lg py-1 flex flex-col">
            {folded.map((t) => (
              <Link key={t.href} href={t.href} onClick={press(t.href)} className="text-xs px-3 py-1.5 hover:bg-[var(--zebra)] flex items-center justify-between gap-2">
                {t.label}{badge(t.href)}
              </Link>
            ))}
          </div>
        </details>
      )}
      {HELP_FOR[key] && (
        <Link href={`/help?cat=${HELP_FOR[key]}`} className="ml-auto text-2xs font-mono font-bold w-6 h-6 grid place-items-center rounded-full border border-[var(--line)] text-[var(--mute)] hover:text-[var(--ink)]" title={`Help with ${stage.label}`} aria-label={`Help with ${stage.label}`} data-strip-help>
          ?
        </Link>
      )}
    </nav>
  );
}
