import { NextRequest, NextResponse } from "next/server";
import { requireMembership, canAdmin } from "@/lib/acl";
import { exchangeAnalyticsCode } from "@/lib/google/analytics-oauth";
import { getPublicUrl } from "@/lib/public-url";

// Google redirects here after the user consents to the Search Console + GA4
// read scopes. Same security shape as the YouTube callback: the flow only
// completes for a SIGNED-IN admin whose current workspace matches the `state`
// we sent — a stray or forged callback can't attach a token elsewhere.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const oauthError = url.searchParams.get("error");
  // ⚠ Redirect against the PUBLIC origin, never url.origin: behind Railway's
  // proxy req.url carries the container's internal host (localhost:8080), and
  // a redirect built on it strands the user on a dead page after consent.
  const publicOrigin = await getPublicUrl();
  const back = (msg: string, ok = false) =>
    NextResponse.redirect(new URL(`/admin/analytics?${ok ? "ok" : "err"}=${encodeURIComponent(msg)}`, publicOrigin));

  if (oauthError) return back(`Google returned "${oauthError}".`);
  if (!code || !state) return back("Missing authorization code.");

  let workspaceId: string;
  try {
    const { workspace, membership } = await requireMembership();
    if (!canAdmin(membership.role)) return back("Only an admin can connect Google Analytics.");
    workspaceId = workspace.id;
  } catch {
    return back("Sign in as an admin, then connect Google again.");
  }

  if (state !== workspaceId) {
    return back("This authorization was started for a different workspace. Try again from this workspace.");
  }

  const result = await exchangeAnalyticsCode(workspaceId, code, publicOrigin);
  return back(result.message, result.ok);
}
