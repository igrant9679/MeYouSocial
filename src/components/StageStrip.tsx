"use client";

import { useState, useSyncExternalStore, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { STAGES, currentTab, stageEntries, stageFor, type StageEntry } from "@/lib/stages";
import type { StripCounts } from "@/lib/stage-counts";
import { noShellSnapshot, shellSnapshot, subscribeShell } from "@/lib/shell-live";
import type { Role } from "@prisma/client";
import { canFollow } from "@/lib/role-links";

/** Each stage's Help section, for the strip's "?" (E-SHL-11). */
const HELP_FOR: Record<string, string> = {
  "/research": "intel", "/ideas": "blog", "/drafts": "writing", "/publish": "publishing",
  "/distribute": "social", "/measure": "insights", "/brand": "brand", "/setup": "team-admin",
};

/** Entries shown inline at laptop widths before the rest fold into More (E-SHL-13). */
const INLINE = 6;

/**
 * The persistent stage strip — mounted once in the app shell, so every page a
 * stage owns shows the same bar: the stage's Overview, then its tabs, with the
 * current one lit. It is what makes "click a tab, keep the tabs" true; before,
 * the tabs lived on the overview page only and each module page brought its
 * own unrelated bar (the owner: "I'm either lost with no way back or taken to
 * a completely different navigation").
 *
 * TWO ROWS since 2026-11-17 (the owner's "Yes, regroup tabs"). The first row
 * is the stage's entries (lib/stages.ts `stageEntries`): a page that stands
 * alone, or a GROUP of pages under one name — Settings went from sixteen tabs
 * to five groups. The second row appears only inside a group and lists that
 * group's pages; a group's own link opens its first page. Pages kept their
 * names and URLs, so "Settings → Keys" is still Keys, under "AI & keys".
 *
 * Count badges (lib/stage-counts.ts) sit after a page's label when there is
 * something to count — red when a person has to act, muted when it is news.
 * ⚠ A group's own badge counts only what a person must act on: its pages
 * count different things (posts scheduled, drafts), and their sum would be a
 * number of nothing in particular. The news stays on the page's own tab.
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
  const entries = stageEntries(tabs, stage.href);
  // The stage's own page may sit in a group (Measure's Overview); it is matched by path, never as a tab.
  const pages = tabs.filter((t) => t.href !== stage.href);
  const home = entries.find((e) => e.home) ?? null;
  // A tab on this same path (the one you're on, or a ?query variant) is never "pending".
  const pendingHref = clicked && clicked.from === pathname && clicked.href.split("?")[0] !== pathname ? clicked.href : null;
  // A page no tab owns (an idea's or a post's own page) lights Overview, so the
  // strip always says where you are (tracker #2) — it used to light nothing.
  const matched = pendingHref || pathname === stage.href ? null : currentTab(pathname, pages);
  const onOverview = pendingHref ? pendingHref === stage.href : pathname === stage.href || !matched;
  const current = pendingHref ? pages.find((t) => t.href === pendingHref) ?? null : matched;
  const pendingMark = pendingHref ? "" : undefined;
  // The entry you are in: the group or page holding the current tab, or the one holding the Overview.
  const openEntry = onOverview ? home : entries.find((e) => e.tabs.some((t) => t.href === current?.href)) ?? null;
  const isOn = (e: StageEntry) => e === openEntry;
  // A plain left click only — a new tab or window leaves this page where it is.
  const press = (href: string) => (e: MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    setClicked({ href, from: pathname });
  };

  const pill = (n: number, urgent: boolean, title: string) => (
    <span
      className="font-mono text-micro font-bold px-1.5 py-px rounded-full leading-4 tabular-nums"
      style={urgent ? { background: "var(--rose-soft)", color: "var(--rose-on)" } : { background: "var(--zebra)", color: "var(--mute)" }}
      title={title}
    >
      {n}
    </span>
  );
  const badge = (href: string) => {
    const c = counts[href.split("?")[0]];
    if (!c || c.n <= 0) return null;
    return pill(c.n, !!c.urgent, c.urgent ? `${c.n} waiting on a person` : `${c.n}`);
  };
  /** What waits on a person anywhere under a group. */
  const urgentIn = (e: StageEntry) => e.tabs.reduce((n, t) => { const c = counts[t.href.split("?")[0]]; return n + (c?.urgent ? c.n : 0); }, 0);
  const entryBadge = (e: StageEntry) => {
    if (!e.group) return badge(e.tabs[0].href);
    const n = urgentIn(e);
    return n > 0 ? pill(n, true, `${n} waiting on a person`) : null;
  };

  // Past INLINE, an entry folds into More between phone and wide widths — never the one you're in.
  const overflow = entries.length > INLINE + 1;
  const folded = overflow ? entries.slice(INLINE).filter((e) => !isOn(e)) : [];
  const moreBadge = folded.reduce((n, e) => n + (e.group ? urgentIn(e) : counts[e.tabs[0].href.split("?")[0]]?.n ?? 0), 0);
  const moreUrgent = folded.some((e) => (e.group ? urgentIn(e) > 0 : counts[e.tabs[0].href.split("?")[0]]?.urgent));

  const linkClass = "text-2xs font-semibold px-2.5 py-2 border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5";
  const lit = { borderColor: "var(--accent)", color: "var(--accent-on)" };
  const dim = { borderColor: "transparent", color: "var(--mute)" };
  const subClass = "text-2xs font-semibold px-2.5 py-1 rounded-full transition-colors inline-flex items-center gap-1.5 hover:text-[var(--ink)]";
  const subLit = { background: "var(--accent-soft)", color: "var(--accent-on)" };
  const subDim = { color: "var(--mute)" };

  // The second row: the pages of the group you are in.
  const sub = openEntry?.group ? openEntry : null;
  const subOn = (href: string) => (href === stage.href ? onOverview : current?.href === href);

  return (
    <nav
      aria-label={`${stage.label} pages`}
      className="sticky top-0 z-30 -mx-6 -mt-6 mb-5 border-b border-[var(--line)] bg-[var(--panel)]"
      data-stage-strip={key}
    >
      <div className="px-6 flex items-center gap-1 flex-wrap max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:whitespace-nowrap">
        <span className="font-mono text-micro font-bold uppercase tracking-wider text-[var(--mute)] pr-2 py-2">{stage.label}</span>
        {!home && (
          <Link href={stage.href} aria-current={pathname === stage.href && !pendingHref ? "page" : undefined} className={linkClass} style={onOverview ? lit : dim} onClick={press(stage.href)} data-pending={onOverview ? pendingMark : undefined}>
            Overview{badge(stage.href)}
          </Link>
        )}
        {entries.map((e, i) => {
          const on = isOn(e);
          const folds = overflow && i >= INLINE && !on;
          return (
            <Link
              key={e.key}
              href={e.href}
              // A page standing alone IS the current page when lit; inside a group the second row says which page.
              aria-current={on && !pendingHref ? (e.group ? "true" : "page") : undefined}
              className={`${linkClass} hover:text-[var(--ink)]${folds ? " sm:hidden xl:inline-flex" : ""}`}
              style={on ? lit : dim}
              onClick={press(e.href)}
              data-pending={on ? pendingMark : undefined}
              data-strip-group={e.group ? e.label : undefined}
              // What is inside a group, on hover — "Settings → Keys" is found without opening each one.
              title={e.group ? e.tabs.map((t) => t.label).join(" · ") : undefined}
            >
              {e.label}{e.home && !e.group ? badge(stage.href) : entryBadge(e)}
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
              {folded.map((e) => (
                <Link key={e.key} href={e.href} onClick={press(e.href)} className="text-xs px-3 py-1.5 hover:bg-[var(--zebra)] flex items-center justify-between gap-2">
                  {e.label}{entryBadge(e)}
                </Link>
              ))}
            </div>
          </details>
        )}
        {HELP_FOR[key] && (
          <Link href={`/help?cat=${HELP_FOR[key]}`} className="ml-auto text-2xs font-mono font-bold w-6 h-6 grid place-items-center rounded-full border border-[var(--line)] text-[var(--mute)] hover:text-[var(--ink)] shrink-0" title={`Help with ${stage.label}`} aria-label={`Help with ${stage.label}`} data-strip-help>
            ?
          </Link>
        )}
      </div>
      {sub && (
        <div
          role="group"
          aria-label={`${sub.label} pages`}
          className="px-6 py-1.5 flex items-center gap-1 flex-wrap max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:whitespace-nowrap border-t border-[var(--line)]"
          data-strip-sub={sub.label}
        >
          {sub.tabs.map((t) => {
            const on = subOn(t.href);
            return (
              <Link key={t.href} href={t.href} aria-current={on && !pendingHref ? "page" : undefined} className={subClass} style={on ? subLit : subDim} onClick={press(t.href)} data-pending={on ? pendingMark : undefined}>
                {t.label}{badge(t.href)}
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}
