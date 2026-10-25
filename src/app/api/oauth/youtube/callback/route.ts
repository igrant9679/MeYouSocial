import { NextRequest, NextResponse } from "next/server";
import { requireMembership, canAdmin } from "@/lib/acl";
import { exchangeYoutubeCode } from "@/lib/youtube/oauth";
import { consumeOauthState } from "@/lib/google/oauth-state";
import { getPublicUrl } from "@/lib/public-url";

// Google redirects here after the user consents.
//
// Security: the flow is only completed for a SIGNED-IN admin whose current
// workspace matches the `state` we sent. A stray or forged callback for another
// workspace is rejected rather than attaching a token to it.

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
    if (!canAdmin(membership.role)) return back("Only an admin can connect YouTube.");
    workspaceId = workspace.id;
  } catch {
    return back("Sign in as an admin, then connect YouTube again.");
  }

  // The state must be the single-use nonce THIS workspace was issued when an
  // admin pressed Connect (a guessable workspace id used to be accepted).
  if (!(await consumeOauthState(workspaceId, "youtube", state))) {
    return back("This authorization link has expired or wasn't started from this workspace. Press Connect YouTube again.");
  }

  const result = await exchangeYoutubeCode(workspaceId, code, publicOrigin);
  return back(result.message, result.ok);
}
