import { NextRequest, NextResponse } from "next/server";
import { requireMembership, canAdmin, isPlatformOperator } from "@/lib/acl";
import { exchangeGdriveCode } from "@/lib/storage/gdrive-oauth";
import { getPublicUrl } from "@/lib/public-url";

// Google redirects here after the user consents to Drive access.
//
// Security: storage is PLATFORM infrastructure — one store serves every tenant
// — so unlike the per-workspace YouTube callback this completes only for a
// signed-in ADMIN who is also the platform operator. The `state` nonce is
// verified and burned inside exchangeGdriveCode(), so a replayed or forged
// callback cannot attach a token.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const oauthError = url.searchParams.get("error");
  const back = (msg: string, ok = false) =>
    NextResponse.redirect(new URL(`/admin/api-keys?${ok ? "ok" : "err"}=${encodeURIComponent(msg)}#storage`, url.origin));

  if (oauthError) return back(`Google returned "${oauthError}".`);
  if (!code || !state) return back("Missing authorization code.");

  try {
    const { user, membership } = await requireMembership();
    if (!canAdmin(membership.role) || !isPlatformOperator(user.email)) {
      return back("Storage is managed by the platform operator.");
    }
  } catch {
    return back("Sign in as the platform operator, then connect Drive again.");
  }

  const result = await exchangeGdriveCode(code, state, await getPublicUrl());
  return back(result.message, result.ok);
}
