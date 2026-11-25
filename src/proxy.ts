import { NextResponse, type NextRequest } from "next/server";
import { NONCE_HEADER, pageCsp } from "@/lib/csp";

/**
 * The strict page policy (2026-11-24): a fresh nonce for every page, put in
 * the request's Content-Security-Policy (Next reads it there and stamps it on
 * every script it renders) and in the response's (the browser enforces it).
 * `lib/csp.ts` `pageCsp` says what the policy allows and why.
 *
 * `CSP_REPORT_ONLY=1` sends it as Content-Security-Policy-Report-Only: the
 * browser reports what it would have blocked and runs it anyway — the switch
 * if a page ever breaks under it. The general policy from next.config (no
 * plugins, no <base>, no framing) is enforced either way.
 *
 * Nothing here reads a cookie, a session or the database: who may open a page
 * is decided by the page, as before.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64");
  const policy = pageCsp(nonce, { dev: process.env.NODE_ENV === "development" });
  const reportOnly = process.env.CSP_REPORT_ONLY === "1";

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  // Next finds the nonce in the request's policy — in report-only mode too,
  // so the scripts carry it and the reports show only real strays.
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(reportOnly ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      /*
       * Pages only. Left out, and why:
       * - api/ and uploads/: route handlers (JSON, files, webhooks, uploads in
       *   pieces) — no page scripts, and some send their own policy (lib/csp.ts
       *   OWN_CSP_PATHS). They keep next.config's general policy.
       * - _next/static, _next/image, the icons and the manifest: files.
       * - Server Action calls (the next-action header): they answer with data,
       *   not a page — and ⚠ a proxy buffers the request body it sees, cut at
       *   proxyClientMaxBodySize, so a 25 MB photo posted to an action would
       *   arrive truncated. A form posted before the page hydrated has no such
       *   header; next.config raises the limit to the actions' own for it.
       * - Prefetches: data for a later visit, never rendered as a page.
       */
      source: "/((?!api/|uploads/|_next/static|_next/image|favicon.ico|icon/|apple-icon|manifest.webmanifest).*)",
      missing: [
        { type: "header", key: "next-action" },
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
