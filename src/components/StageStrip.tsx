"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { STAGES, currentTab, stageFor } from "@/lib/stages";
import type { StripCounts } from "@/lib/stage-counts";

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
  counts,
  admin,
  operator,
}: {
  activeChannelId: string | null;
  studio: boolean;
  counts: StripCounts;
  /** Both decided on the SERVER (app/(app)/layout.tsx) so the client never
   *  guesses at a role. Cosmetic only — every admin page keeps its own gate. */
  admin: boolean;
  operator: boolean;
}) {
  const pathname = usePathname() ?? "";
  const key = stageFor(pathname);
  if (!key) return null;
  const stage = STAGES[key];
  const tabs = stage.tabs({ channelId: activeChannelId, studio, admin, operator });
  const onOverview = pathname === stage.href;
  const current = onOverview ? null : currentTab(pathname, tabs);

  const badge = (href: string) => {
    const c = counts[href.split("?")[0]];
    if (!c || c.n <= 0) return null;
    return (
      <span
        className="font-mono text-[9.5px] font-bold px-1.5 py-px rounded-full leading-4 tabular-nums"
        style={c.urgent ? { background: "var(--rose-soft)", color: "var(--rose-on)" } : { background: "var(--zebra)", color: "var(--mute)" }}
        title={c.urgent ? `${c.n} waiting on a person` : `${c.n}`}
      >
        {c.n}
      </span>
    );
  };

  const linkClass = "text-[11px] font-semibold px-2.5 py-2 border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5";
  const lit = { borderColor: "var(--accent)", color: "var(--accent-on)" };
  const dim = { borderColor: "transparent", color: "var(--mute)" };

  return (
    <nav
      aria-label={`${stage.label} pages`}
      className="sticky top-0 z-30 -mx-6 -mt-6 mb-5 px-6 flex items-center gap-1 flex-wrap max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:whitespace-nowrap border-b border-[var(--line)] bg-[var(--panel)]"
    >
      <span className="font-mono text-[10.5px] font-bold uppercase tracking-wider text-[var(--mute)] pr-2 py-2">{stage.label}</span>
      <Link href={stage.href} aria-current={onOverview ? "page" : undefined} className={linkClass} style={onOverview ? lit : dim}>
        Overview{badge(stage.href)}
      </Link>
      {tabs.map((t) => {
        const on = current?.href === t.href;
        return (
          <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined} className={`${linkClass} hover:text-[var(--ink)]`} style={on ? lit : dim}>
            {t.label}{badge(t.href)}
          </Link>
        );
      })}
    </nav>
  );
}
