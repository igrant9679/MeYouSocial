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

  // `access_denied` is overwhelmingly ONE thing here, not a real refusal: the
  // OAuth consent screen is still in "Testing", so Google only lets
  // developer-approved testers through and shows "has not completed the Google
  // verification process". Relaying the bare error code would send the operator
  // hunting for a verification problem they don't have — the app requests only
  // `drive.file`, which is non-sensitive and needs no review.
  if (oauthError === "access_denied") {
    return back(
      'Google blocked the sign-in with "access_denied". If the screen said the app "has not completed the Google verification process",' +
      " the OAuth consent screen is still in Testing, which only admits listed testers." +
      " Fix it in Google Cloud Console → APIs & Services → OAuth consent screen → Audience: either Publish app" +
      " (this app asks only for the non-sensitive drive.file scope, so there is no review to pass), or add your Google address" +
      " under Test users. Publishing is the one to prefer — Google expires the refresh tokens of Testing-status apps after 7 days.",
    );
  }
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
