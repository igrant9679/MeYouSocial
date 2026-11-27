import Link from "next/link";
import { Sparkles } from "lucide-react";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { canFollow } from "@/lib/role-links";
import { CARD_MAX, whatsNewDay, whatsNewFor } from "@/lib/whats-new";
import { dismissWhatsNewAction } from "@/app/actions/whats-new";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * The Inbox's "What's new" card (lib/whats-new.ts says which entries and why).
 *
 * Quiet by design: it renders nothing when there is nothing new for this person,
 * lists at most CARD_MAX entries, and "Got it" hides exactly the entries it listed
 * (never one the person hasn't seen) — for them, in every workspace, since a change
 * to the app is the same everywhere. Dismissals are read across all the person's
 * workspaces for that reason. A server component with a server-action form: no
 * JavaScript needed.
 */
export async function WhatsNew({ userId, role, joinedAt }: { userId: string; role: Role; joinedAt: Date }) {
  const dismissed = await db.elsieDismissal.findMany({ where: { userId, key: { startsWith: "new:" } }, select: { key: true } });
  const entries = whatsNewFor({
    now: new Date(),
    joinedAt,
    admin: role === "ADMIN",
    canOpen: (href) => canFollow(href, role),
    dismissed: new Set(dismissed.map((d) => d.key)),
  });
  if (!entries.length) return null;
  const shown = entries.slice(0, CARD_MAX);
  const more = entries.length - shown.length;

  return (
    <section className="card mb-4" data-whats-new={entries.length} aria-labelledby="whats-new-title">
      <div className="flex items-baseline gap-2 flex-wrap mb-2">
        <h2 id="whats-new-title" className="font-mono text-sm font-bold m-0 flex items-center gap-1.5">
          <Sparkles className="w-4 h-4" style={{ color: "var(--violet-on)" }} aria-hidden />{" "}What&apos;s new
        </h2>
        <span className="text-xs text-[var(--mute)]">
          {entries.length === 1 ? "One change to the app" : `${entries.length} changes to the app`} since you last looked
        </span>
      </div>
      <ul className="m-0 p-0 list-none flex flex-col gap-2">
        {shown.map((e) => (
          <li key={e.id} data-whats-new-entry={e.id}>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-sm font-semibold">{e.title}</span>
              <span className="text-2xs font-mono text-[var(--mute)]">{whatsNewDay(e)}</span>
            </div>
            <p className="m-0 text-xs text-[var(--mute)]">
              {e.body}
              {e.href && (
                <>
                  {" "}
                  <Link href={e.href} className="underline whitespace-nowrap">
                    {e.cta ?? "Open it"} →
                  </Link>
                </>
              )}
            </p>
          </li>
        ))}
      </ul>
      <form action={dismissWhatsNewAction} className="mt-3 flex items-center gap-3 flex-wrap">
        {shown.map((e) => (
          <input key={e.id} type="hidden" name="id" value={e.id} />
        ))}
        <SubmitButton className="btn sm" pendingText="Hiding…">
          {more > 0 ? "Got it, show the next" : "Got it, hide these"}
        </SubmitButton>
        <span className="text-xs text-[var(--mute)]">
          {more > 0 ? `${more} more after these. ` : ""}
          Every change is in{" "}
          <Link href="/help?cat=whats-new" className="underline">
            Help → What&apos;s new
          </Link>
          .
        </span>
      </form>
    </section>
  );
}
