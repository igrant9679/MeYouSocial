import { formatZonedMoment } from "@/lib/zoned-dates";
import { getPostingTimeZone } from "@/lib/social/slots";
import { isTimeZone } from "@/lib/display-zone";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { SubmitButton } from "@/components/SubmitButton";
import {
  clearReadNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  saveNotificationPreferencesAction,
} from "@/app/actions/notifications";
import { KIND_LABELS, NOTIFICATION_KINDS, type NotificationKind } from "@/lib/notify";
import { resolveEmailSender } from "@/lib/unipile/accounts";
import { listNotifications, notificationsHref, parseNotificationQuery, safeNotificationTarget, unreadElsewhere } from "@/lib/notification-list";

// FR-16 — the in-app inbox plus per-kind delivery preferences. Email rides the
// workspace's existing SMTP config; Slack is a connector, not built here.
// E-SHL-08: filters by kind, unread only, pages, an all-workspaces view, and
// opening an item marks it read (notifications/open/[id]).

const KIND_HUE: Record<NotificationKind, string> = {
  approval_needed: "violet",
  approval_decided: "violet",
  published: "green",
  publish_failed: "rose",
  scheduled: "blue",
  assigned: "amber",
  comment: "cyan",
  mentioned: "cyan",
  account_broken: "rose",
  generation_failed: "rose",
  security: "amber",
  submission: "pink",
  job_failed: "rose",
  daily_digest: "teal",
  ai_budget: "amber",
};

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { user, workspace } = await requireMembership();
  const memberships = user.memberships.filter((m) => m.status === "active");
  const multi = memberships.length > 1;
  const parsed = parseNotificationQuery(sp);
  // The all-workspaces view (E-SHL-08) is only a choice for someone in more than one.
  const q = { ...parsed, scope: multi ? parsed.scope : ("here" as const) };
  const names = new Map(memberships.map((m) => [m.workspaceId, m.workspace.name]));
  const workspaceIds = q.scope === "all" ? memberships.map((m) => m.workspaceId) : [workspace.id];
  const [list, prefs, sender, elsewhere] = await Promise.all([
    listNotifications(user.id, workspaceIds, q),
    db.notificationPreference.findMany({ where: { workspaceId: workspace.id, userId: user.id } }),
    // Name the route out. Without a connected mailbox every email below — the
    // morning digest included — is logged, not delivered (ENG-20).
    resolveEmailSender(workspace.id).catch(() => null),
    q.scope === "here" ? unreadElsewhere(user.id, memberships.map((m) => m.workspaceId).filter((id) => id !== workspace.id)) : 0,
  ]);
  if (q.page > list.pages) redirect(notificationsHref(q, { page: list.pages }));
  // Each item's time in its own workspace's posting zone — the zone its schedules are in.
  // E-SHL-09: one zone for everything when the reader chose theirs; else each workspace's own.
  const mine = user.timeZone && isTimeZone(user.timeZone) ? user.timeZone : null;
  const zones = new Map(
    await Promise.all([...new Set(list.items.map((i) => i.workspaceId))].map(async (id) => [id, await getPostingTimeZone(id).catch(() => "UTC")] as const)),
  );
  const prefBy = new Map(prefs.map((p) => [p.kind, p]));
  const error = typeof sp.error === "string" ? sp.error : null;
  const filtered = !!q.kind || q.unread;
  const chip = (active: boolean) =>
    "text-xs font-mono px-2.5 py-1 rounded-md border " + (active ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--line-2)] text-[var(--mute)]");

  return (
    <main className="w-full">
      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--blue-soft)", color: "var(--blue-on)" }}>
          <Bell className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div className="min-w-40 flex-1">
          <h1 className="font-mono font-bold text-2xl leading-tight">Notifications</h1>
          <p className="text-xs text-[var(--mute)]" data-unread={list.unread}>
            {list.unread ? `${list.unread} unread` : "All caught up"} · {q.scope === "all" ? `all ${memberships.length} workspaces` : workspace.name}
          </p>
        </div>
      </div>

      {error && (
        <p className="card text-xs mb-4" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>{error}</p>
      )}

      {multi && (
        <nav className="flex flex-wrap items-center gap-1 mb-2" data-notification-scope>
          <Link href={notificationsHref(q, { scope: "here", page: 1 })} className={chip(q.scope === "here")}>{workspace.name}</Link>
          <Link href={notificationsHref(q, { scope: "all", page: 1 })} className={chip(q.scope === "all")} data-scope-all>
            All workspaces{elsewhere ? ` · ${elsewhere} unread elsewhere` : ""}
          </Link>
        </nav>
      )}

      <nav className="flex flex-wrap items-center gap-1 mb-4" data-notification-kinds>
        <Link href={notificationsHref(q, { kind: null, page: 1 })} className={chip(!q.kind)}>
          All ({list.kinds.reduce((s, k) => s + k.count, 0)})
        </Link>
        {list.kinds.map((k) => (
          <Link key={k.kind} href={notificationsHref(q, { kind: k.kind, page: 1 })} className={chip(q.kind === k.kind)} title={KIND_LABELS[k.kind]} data-kind-chip={k.kind}>
            {k.kind.replace(/_/g, " ")} ({k.count})
          </Link>
        ))}
        {/* A kind with nothing in it (an old link) still shows as chosen, so it can be cleared. */}
        {q.kind && !list.kinds.some((k) => k.kind === q.kind) && (
          <span className={chip(true)} data-kind-chip={q.kind}>{q.kind.replace(/_/g, " ")} (0)</span>
        )}
        <Link href={notificationsHref(q, { unread: !q.unread, page: 1 })} className={chip(q.unread) + " ml-auto"} data-unread-only={q.unread ? "on" : "off"}>
          {q.unread ? "✓ Unread only" : "Unread only"}
        </Link>
      </nav>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {list.unread > 0 && (
          <form action={markAllNotificationsReadAction}>
            <input type="hidden" name="scope" value={q.scope} />
            {q.kind && <input type="hidden" name="kind" value={q.kind} />}
            <SubmitButton className="btn">{q.kind || q.scope === "all" ? "Mark these read" : "Mark all read"}</SubmitButton>
          </form>
        )}
        {list.anyRead && (
          <form action={clearReadNotificationsAction}>
            <input type="hidden" name="scope" value={q.scope} />
            {q.kind && <input type="hidden" name="kind" value={q.kind} />}
            <SubmitButton className="btn">Clear read</SubmitButton>
          </form>
        )}
      </div>

      {list.items.length === 0 ? (
        <div className="card" data-notifications-empty>
          <p className="text-xs text-[var(--mute)]">
            {filtered ? (
              <>
                Nothing matches.{" "}
                <Link href={notificationsHref(q, { kind: null, unread: false, page: 1 })} className="underline">Show everything →</Link>
              </>
            ) : (
              "Nothing yet. Approvals, publishes, failures, schedules, assignments and comments land here."
            )}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2 mb-4">
          {list.items.map((n) => {
            const hue = KIND_HUE[n.kind as NotificationKind] ?? "cyan";
            const target = safeNotificationTarget(n.url);
            return (
              <li
                key={n.id}
                className="card flex flex-wrap items-start gap-2"
                style={n.readAt ? { opacity: 0.65 } : undefined}
                data-notification={n.id}
                data-read={n.readAt ? "1" : "0"}
              >
                <span
                  className="font-mono text-[10px] px-2 py-0.5 rounded-full shrink-0"
                  style={{ background: `var(--${hue}-soft)`, color: `var(--${hue}-on)` }}
                >
                  {n.kind.replace(/_/g, " ")}
                </span>
                {q.scope === "all" && (
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded-full shrink-0 border border-[var(--line-2)]" data-notification-workspace={n.workspaceId}>
                    {names.get(n.workspaceId) ?? "Workspace"}
                  </span>
                )}
                <div className="flex-1 min-w-40">
                  {target ? (
                    // Through the open route, so following it marks it read (and switches
                    // workspace when it's another's). A plain <a>: a prefetch must never mark anything read.
                    <a href={`/notifications/open/${n.id}`} className="text-sm font-semibold underline">{n.title}</a>
                  ) : (
                    <span className="text-sm font-semibold">{n.title}</span>
                  )}
                  {n.body && <p className="text-xs text-[var(--mute)] mt-0.5">{n.body}</p>}
                  <p className="font-mono text-[10px] text-[var(--mute)] mt-0.5">
                    {formatZonedMoment(n.createdAt, mine ?? zones.get(n.workspaceId) ?? "UTC")}
                    {n.emailedAt ? " · emailed" : ""}
                  </p>
                </div>
                {!n.readAt && (
                  <form action={markNotificationReadAction}>
                    <input type="hidden" name="id" value={n.id} />
                    <button className="btn text-[11px]">Mark read</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {list.pages > 1 && (
        <nav className="flex flex-wrap items-center gap-3 mb-6 text-xs font-mono" data-notification-pages>
          {q.page > 1 ? <Link href={notificationsHref(q, { page: q.page - 1 })} className="underline">← Newer</Link> : <span className="text-[var(--mute)]">← Newer</span>}
          <span className="text-[var(--mute)]">Page {q.page} of {list.pages} · {list.total} in all</span>
          {q.page < list.pages ? <Link href={notificationsHref(q, { page: q.page + 1 })} className="underline">Older →</Link> : <span className="text-[var(--mute)]">Older →</span>}
        </nav>
      )}

      {/* Preferences are per workspace — these are for the one you're in. */}
      <form action={saveNotificationPreferencesAction} className="card mt-2">
        <h2 className="text-sm font-semibold mb-1">Delivery{multi ? ` — ${workspace.name}` : ""}</h2>
        {sender ? (
          <p className="text-xs text-[var(--mute)] mb-3">
            Email goes out from <b>{sender.name ?? "the connected mailbox"}</b>.
          </p>
        ) : (
          <p className="text-xs mb-3" style={{ color: "var(--amber-on)" }}>
            <b>No mailbox is connected for {workspace.name}</b>, so these emails — and the morning digest — are logged,
            not delivered. Outbound SMTP is blocked on this host; a connected mailbox is the only route out.{" "}
            <Link href="/admin/connections" className="underline">Connect one →</Link>
          </p>
        )}
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[var(--mute)]">
              <th className="pb-1 font-medium">Event</th>
              <th className="pb-1 font-medium w-16">In-app</th>
              <th className="pb-1 font-medium w-16">Email</th>
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_KINDS.map((kind) => {
              const p = prefBy.get(kind);
              return (
                <tr key={kind} className="border-t border-[var(--line)]">
                  <td className="py-1.5">{KIND_LABELS[kind]}</td>
                  <td className="py-1.5">
                    {/* The digest has no in-app form — Home IS its in-app form.
                        A checkbox here would be a control wired to nothing. */}
                    {kind === "daily_digest" ? (
                      <span className="text-[var(--mute)]" title="Home is the in-app digest">—</span>
                    ) : (
                      <input type="checkbox" name={`inapp_${kind}`} defaultChecked={p ? p.inApp : true} />
                    )}
                  </td>
                  <td className="py-1.5">
                    <input type="checkbox" name={`email_${kind}`} defaultChecked={p ? p.email : DEFAULT_EMAIL[kind]} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-3">
          <SubmitButton className="btn primary">Save preferences</SubmitButton>
        </div>
      </form>
    </main>
  );
}

// Mirrors the defaults in src/lib/notify.ts so an unsaved form shows the truth.
const DEFAULT_EMAIL: Record<NotificationKind, boolean> = {
  approval_needed: true,
  approval_decided: true,
  published: false,
  publish_failed: true,
  scheduled: false,
  assigned: true,
  comment: false,
  mentioned: true,
  account_broken: true,
  generation_failed: false,
  security: true,
  submission: false,
  job_failed: false,
  daily_digest: true,
  ai_budget: true,
};
