import Link from "next/link";
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

// FR-16 — the in-app inbox plus per-kind delivery preferences. Email rides the
// workspace's existing SMTP config; Slack is a connector, not built here.

const KIND_HUE: Record<NotificationKind, string> = {
  approval_needed: "violet",
  published: "green",
  publish_failed: "rose",
  scheduled: "blue",
  assigned: "amber",
  comment: "cyan",
};

export default async function NotificationsPage() {
  const { user, workspace } = await requireMembership();
  const [items, prefs] = await Promise.all([
    db.notification.findMany({
      where: { workspaceId: workspace.id, userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.notificationPreference.findMany({ where: { workspaceId: workspace.id, userId: user.id } }),
  ]);
  const prefBy = new Map(prefs.map((p) => [p.kind, p]));
  const unread = items.filter((i) => !i.readAt).length;

  return (
    <main className="w-full">
      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--blue-soft)", color: "var(--blue-on)" }}>
          <Bell className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div className="min-w-40 flex-1">
          <h1 className="font-mono font-bold text-2xl leading-tight">Notifications</h1>
          <p className="text-xs text-[var(--mute)]">
            {unread ? `${unread} unread` : "All caught up"} · {workspace.name}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {unread > 0 && (
          <form action={markAllNotificationsReadAction}>
            <SubmitButton className="btn">Mark all read</SubmitButton>
          </form>
        )}
        {items.some((i) => i.readAt) && (
          <form action={clearReadNotificationsAction}>
            <SubmitButton className="btn">Clear read</SubmitButton>
          </form>
        )}
      </div>

      {items.length === 0 ? (
        <div className="card">
          <p className="text-xs text-[var(--mute)]">
            Nothing yet. Approvals, publishes, failures, schedules, assignments and comments land here.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2 mb-6">
          {items.map((n) => {
            const hue = KIND_HUE[n.kind as NotificationKind] ?? "cyan";
            return (
              <li
                key={n.id}
                className="card flex flex-wrap items-start gap-2"
                style={n.readAt ? { opacity: 0.65 } : undefined}
              >
                <span
                  className="font-mono text-[10px] px-2 py-0.5 rounded-full shrink-0"
                  style={{ background: `var(--${hue}-soft)`, color: `var(--${hue}-on)` }}
                >
                  {n.kind.replace(/_/g, " ")}
                </span>
                <div className="flex-1 min-w-40">
                  {n.url ? (
                    <Link href={n.url} className="text-sm font-semibold underline">{n.title}</Link>
                  ) : (
                    <span className="text-sm font-semibold">{n.title}</span>
                  )}
                  {n.body && <p className="text-xs text-[var(--mute)] mt-0.5">{n.body}</p>}
                  <p className="font-mono text-[10px] text-[var(--mute)] mt-0.5">
                    {n.createdAt.toISOString().slice(0, 16).replace("T", " ")}
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

      <form action={saveNotificationPreferencesAction} className="card">
        <h2 className="text-sm font-semibold mb-1">Delivery</h2>
        <p className="text-xs text-[var(--mute)] mb-3">
          Email uses this workspace&apos;s SMTP settings — if none are configured, mail is logged rather than sent.
        </p>
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
                    <input type="checkbox" name={`inapp_${kind}`} defaultChecked={p ? p.inApp : true} />
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
  published: false,
  publish_failed: true,
  scheduled: false,
  assigned: true,
  comment: false,
};
