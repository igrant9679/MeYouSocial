import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { verifyZernioSignature, listZernioAccounts } from "@/lib/zernio";
import { saveZernioAccount } from "@/lib/zernio/accounts";

/**
 * Zernio webhook.
 *
 * Security model, and why it differs from the Unipile one it replaces: Zernio
 * SIGNS its deliveries (`X-Zernio-Signature`, lowercase-hex HMAC-SHA256 of the
 * raw body). So the check is a real signature verification rather than the
 * Unipile route's approach of re-fetching the account to prove it exists.
 *
 * The raw body text is what gets hashed — `req.text()`, never a re-serialised
 * object, because re-encoding JSON changes bytes and therefore the digest.
 *
 * If no secret is configured the endpoint REFUSES everything rather than
 * accepting unsigned posts: an open endpoint that writes account rows is worth
 * more to an attacker than a broken one is to us.
 *
 * Account → workspace mapping comes from `profileId`, which we own (we created
 * the profile and stored it on the workspace). That's a genuine improvement on
 * Unipile, where the mapping rode in a free-text `name` field with no way to
 * recover from a missed delivery.
 */

export const dynamic = "force-dynamic";

type ZernioEvent = {
  type?: string;
  event?: string;
  data?: Record<string, unknown>;
  payload?: Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  const secret = await getSetting("zernio:webhook_secret");
  if (!secret) {
    // Fail closed. Configure the secret under Admin → Connections.
    return NextResponse.json({ error: "webhook secret not configured" }, { status: 503 });
  }

  const raw = await req.text();
  const signature = req.headers.get("x-zernio-signature") ?? req.headers.get("x-late-signature") ?? "";
  if (!verifyZernioSignature(raw, signature, secret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let event: ZernioEvent;
  try {
    event = JSON.parse(raw) as ZernioEvent;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const type = (event.type ?? event.event ?? "").toLowerCase();
  const data = event.data ?? event.payload ?? {};

  if (type === "account.connected" || type === "account.disconnected") {
    const profileId = String(data.profileId ?? "");
    const accountId = String(data.accountId ?? data.id ?? "");
    if (!profileId || !accountId) return NextResponse.json({ ok: true, ignored: "missing ids" });

    const workspace = await db.workspace.findFirst({ where: { zernioProfileId: profileId }, select: { id: true } });
    if (!workspace) return NextResponse.json({ ok: true, ignored: "unknown profile" });

    if (type === "account.disconnected") {
      await db.zernioAccount.updateMany({
        where: { workspaceId: workspace.id, accountId },
        data: { status: "disconnected" },
      });
      return NextResponse.json({ ok: true });
    }

    // Re-read from Zernio rather than trusting the payload's own fields: the
    // signature proves the sender, but listing gives us the canonical record
    // (username, display name, active flag) in one shape.
    const remote = await listZernioAccounts({ profileId });
    const found = remote.find((a) => a.id === accountId);
    if (!found) return NextResponse.json({ ok: true, ignored: "account not visible" });
    await saveZernioAccount(workspace.id, found);
    return NextResponse.json({ ok: true });
  }

  // post.published / post.failed / post.partial — reconcile our own record so a
  // scheduled post that Zernio published later reflects reality here too.
  //
  // ⚠ SCOPE THIS TO THE LEG THE EVENT IS ABOUT. One Zernio post fans out to
  // every selected network, so a bare `where: { providerPostId }` applies one
  // platform's outcome to all of them — an Instagram failure would mark the
  // LinkedIn and Facebook legs failed too, and a later success would flip them
  // all back. The singular `platformPostUrl` / `errorMessage` fields say these
  // deliveries are per-platform. When the payload names an account or platform
  // we narrow to it; when it names neither the event really is about the whole
  // post, and updating every leg is then correct.
  if (type.startsWith("post.")) {
    const postId = String(data.postId ?? data.id ?? "");
    if (!postId) return NextResponse.json({ ok: true, ignored: "no post id" });
    const url = typeof data.platformPostUrl === "string" ? data.platformPostUrl : null;
    const failed = type === "post.failed";

    const accountId = typeof data.accountId === "string" ? data.accountId : null;
    const platform = typeof data.platform === "string" ? data.platform.toLowerCase() : null;
    const scope = accountId ? { accountId } : platform ? { provider: platform } : {};

    const { count } = await db.socialPostTarget.updateMany({
      where: { providerPostId: postId, ...scope },
      data: failed
        ? { status: "failed", error: String(data.errorMessage ?? "Zernio reported the post failed").slice(0, 500) }
        : { status: "posted", postedAt: new Date(), error: null, ...(url ? { platformPostUrl: url } : {}) },
    });

    // Re-roll the parent post from its targets, so a per-leg event moves the
    // post between posted / partial / failed instead of leaving whatever the
    // send-time roll-up wrote.
    const target = await db.socialPostTarget.findFirst({
      where: { providerPostId: postId },
      select: { postId: true },
    });
    if (target) {
      const all = await db.socialPostTarget.findMany({ where: { postId: target.postId } });
      const posted = all.filter((t) => t.status === "posted").length;
      const stillPending = all.some((t) => t.status === "pending");
      await db.socialPost.update({
        where: { id: target.postId },
        data: {
          status:
            posted === all.length ? "posted" : posted > 0 ? "partial" : stillPending ? "publishing" : "failed",
          ...(posted > 0 ? {} : { publishedAt: null }),
        },
      });
    }
    return NextResponse.json({ ok: true, updated: count });
  }

  // Everything else (inbox, ads, calls) is acknowledged and ignored.
  return NextResponse.json({ ok: true, ignored: type || "unknown" });
}

/** Zernio may probe the URL; answer 200 so it validates. */
export async function GET() {
  return NextResponse.json({ ok: true, service: "zernio-webhook" });
}
