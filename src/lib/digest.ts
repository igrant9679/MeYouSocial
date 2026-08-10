import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { getHomeData, type HomeDecision } from "@/lib/home";
import { getPostingTimeZone, zonedParts } from "@/lib/social/slots";
import { emailFor } from "@/lib/email";
import { getPublicUrl } from "@/lib/public-url";
import { writeAudit } from "@/lib/governance";

/**
 * The morning digest — Home's decision queue, delivered.
 *
 * The end state of an autonomous engine is that on a quiet day nobody opens
 * the app at all. This email is that last step: each morning, IF something
 * needs a human, the workspace's admins get one message listing exactly what,
 * with a link per item. The rules that keep it worth opening:
 *
 * ⚠ NO EMAIL ON A QUIET DAY. Silence IS the signal — an "all clear, nothing
 *   to do!" email every morning trains people to delete the digest unread,
 *   and then the one that mattered goes down with it.
 * ⚠ SENT ONLY WHEN SOMETHING *URGENT* EXISTS (a warn-severity decision).
 *   Info items ride along in the same email as a secondary list, but never
 *   trigger one by themselves: "6 ideas to triage" and "analytics not
 *   configured" repeat daily for weeks, and a digest that repeats itself
 *   becomes wallpaper. Warn items also repeat until fixed — but a failed send
 *   or an expiring approval genuinely deserves a daily nag.
 * ⚠ MORNING OR NOT AT ALL. The send window is [digest hour, +3h) in the
 *   WORKSPACE's timezone (same source of truth as the posting queue). If the
 *   server was down through the whole window, that day's digest is skipped —
 *   a "morning digest" arriving at 22:00 is noise with a misleading name.
 *
 * Recipients are the workspace's ADMINs (the decision queue is mostly gated
 * actions), each able to opt out via the existing notification-preference row
 * (kind "daily_digest"). There is deliberately NO in-app copy: Home *is* the
 * in-app digest, and a bell item saying "look at the page you're on" is spam.
 */

const KIND = "daily_digest";
const WINDOW_HOURS = 3;

export async function sweepMorningDigests(): Promise<{ workspaces: number; sent: number }> {
  const workspaces = await db.workspace.findMany({ select: { id: true, name: true } });
  let sent = 0;
  for (const ws of workspaces) {
    try {
      if (await sendDigestIfDue(ws.id, ws.name)) sent++;
    } catch (e) {
      // One workspace's failure must not starve the rest — same rule as every
      // other loop over external resources, and NAME the skipped item.
      console.error(`[digest] ${ws.name} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return { workspaces: workspaces.length, sent };
}

/** Cheap checks first (settings, clock, already-sent) — getHomeData runs last. */
async function sendDigestIfDue(workspaceId: string, workspaceName: string): Promise<boolean> {
  // Default-ON, like auto_image: absent = on, OFF must be the explicit string
  // "false". A pasted-in workspace gets the digest without a setup step.
  const enabled = (await getSetting("digest:enabled", workspaceId).catch(() => "")) !== "false";
  if (!enabled) return false;

  const hourRaw = parseInt(await getSetting("digest:hour", workspaceId).catch(() => ""), 10);
  const digestHour = Number.isFinite(hourRaw) && hourRaw >= 0 && hourRaw <= 23 ? hourRaw : 7;

  const timeZone = await getPostingTimeZone(workspaceId);
  const local = zonedParts(new Date(), timeZone);
  const localHour = Math.floor(local.minute / 60);
  if (localHour < digestHour || localHour >= digestHour + WINDOW_HOURS) return false;

  // Once a day, judged in the workspace's own calendar. The 20-hour lookback
  // is deliberately shorter than 24: a DST shift or a slightly-early tick must
  // not push tomorrow's send out of its window.
  const already = await db.auditLog.findFirst({
    where: {
      workspaceId,
      action: "notify.digest_sent",
      createdAt: { gte: new Date(Date.now() - 20 * 60 * 60 * 1000) },
    },
    select: { id: true },
  });
  if (already) return false;

  const { decisions } = await getHomeData(workspaceId);
  const warn = decisions.filter((d) => d.severity === "warn");
  const info = decisions.filter((d) => d.severity === "info");
  if (warn.length === 0) return false; // quiet day — silence is the signal

  // ── Recipients: admins minus opt-outs ─────────────────────────────────────
  const admins = await db.membership.findMany({
    where: { workspaceId, status: "active", role: "ADMIN" },
    select: { userId: true, user: { select: { email: true, name: true } } },
  });
  const prefs = await db.notificationPreference.findMany({
    where: { workspaceId, kind: KIND, userId: { in: admins.map((a) => a.userId) } },
  });
  const optedOut = new Set(prefs.filter((p) => !p.email).map((p) => p.userId));
  const recipients = admins.filter((a) => a.user.email && !optedOut.has(a.userId));
  if (recipients.length === 0) return false;

  const origin = (await getPublicUrl()).replace(/\/+$/, "");
  const subject = `${warn.length} thing${warn.length === 1 ? "" : "s"} need${warn.length === 1 ? "s" : ""} you — ${workspaceName}`;
  const html = renderHtml({ origin, workspaceName, warn, info });
  const text = renderText({ origin, workspaceName, warn, info });

  const mailer = emailFor(workspaceId);
  let delivered = 0;
  for (const r of recipients) {
    try {
      await mailer.send({ to: r.user.email!, subject, html, text });
      delivered++;
    } catch (e) {
      console.error(`[digest] send to ${r.user.email} failed:`, e instanceof Error ? e.message : e);
    }
  }
  if (delivered === 0) return false; // nothing left the building — try again next tick

  // The once-a-day marker is the audit row — written only after a real send,
  // so a total delivery failure retries on the next tick instead of silently
  // burning the day.
  await writeAudit({
    workspaceId,
    actorId: null,
    action: "notify.digest_sent",
    entityType: "workspace",
    entityId: workspaceId,
    meta: { warn: warn.length, info: info.length, recipients: delivered, timeZone, localHour },
  });
  console.log(`[digest] ${workspaceName}: ${warn.length} warn / ${info.length} info → ${delivered} recipient(s)`);
  return true;
}

// ── Rendering ────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function itemHtml(origin: string, d: HomeDecision): string {
  return [
    `<tr><td style="padding:10px 0;border-top:1px solid #e5e5e5">`,
    `<div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:.08em">${esc(d.module)}</div>`,
    `<div style="font-weight:600;margin:2px 0">${esc(d.title)}</div>`,
    `<div style="color:#555;font-size:13px">${esc(d.detail)}</div>`,
    `<div style="margin-top:6px"><a href="${origin}${d.href}" style="font-size:13px">${esc(d.cta)} →</a></div>`,
    `</td></tr>`,
  ].join("");
}

function renderHtml(opts: { origin: string; workspaceName: string; warn: HomeDecision[]; info: HomeDecision[] }): string {
  const { origin, workspaceName, warn, info } = opts;
  return [
    `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto">`,
    `<h2 style="font-size:17px">Morning digest — ${esc(workspaceName)}</h2>`,
    `<p style="color:#555">These are waiting on a person. Everything else is running on its own.</p>`,
    `<table style="width:100%;border-collapse:collapse">${warn.map((d) => itemHtml(origin, d)).join("")}</table>`,
    info.length
      ? `<h3 style="font-size:13px;color:#777;margin-top:20px">Worth a look, not urgent</h3>` +
        `<table style="width:100%;border-collapse:collapse">${info.map((d) => itemHtml(origin, d)).join("")}</table>`
      : "",
    `<p style="margin-top:20px"><a href="${origin}/dashboard">Open Home</a></p>`,
    // The honesty line: the reader should know silence is deliberate.
    `<p style="color:#888;font-size:12px">This email only arrives when something needs you — a quiet morning sends nothing. Turn it off under Notifications.</p>`,
    `</div>`,
  ].join("\n");
}

function renderText(opts: { origin: string; workspaceName: string; warn: HomeDecision[]; info: HomeDecision[] }): string {
  const { origin, workspaceName, warn, info } = opts;
  const line = (d: HomeDecision) => `- [${d.module}] ${d.title}\n  ${d.detail}\n  ${d.cta}: ${origin}${d.href}`;
  return [
    `Morning digest — ${workspaceName}`,
    ``,
    `Needs you:`,
    ...warn.map(line),
    ...(info.length ? [``, `Worth a look, not urgent:`, ...info.map(line)] : []),
    ``,
    `Home: ${origin}/dashboard`,
    `This email only arrives when something needs you — a quiet morning sends nothing.`,
  ].join("\n");
}
