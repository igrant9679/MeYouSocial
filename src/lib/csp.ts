/**
 * Every Content-Security-Policy the app sends, in one place. No imports —
 * next.config.ts reads this file.
 *
 * ⚠ A ROUTE CAN'T ADD TO THE GENERAL POLICY. When a next.config header rule
 * and a route set the same header, the config's value is what the browser
 * gets. The stored-file routes' sandbox (audit SEC-14) was silently replaced by
 * the general policy from E-SEC-02 until 2026-11-03 (found by growth part cg,
 * whose preview route lost its policy the same way). So next.config applies
 * BASE_CSP to every path EXCEPT `OWN_CSP_PATHS`, and each of those routes
 * sends a complete policy of its own — including frame-ancestors.
 */

/** Every page: no plugins, no <base> hijack, no framing by another site (E-SEC-02). */
export const BASE_CSP = "object-src 'none'; base-uri 'self'; frame-ancestors 'self'";

/**
 * Tenant-uploaded bytes (`/uploads/<key>`, `/api/files/<key>`) must never run
 * as a page of this origin (SEC-14). PDFs get BASE_CSP instead — Chrome
 * refuses to render a sandboxed PDF.
 */
export const STORED_FILE_CSP = "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'";

/**
 * The site preview (E-ART-17): a page borrowed from the connected site — its
 * styles, fonts and images from anywhere; nothing that runs, submits or
 * frames. `sandbox` holds even when it's opened in its own tab;
 * allow-same-origin keeps the app's stored images loading.
 */
export const PREVIEW_CSP = "default-src 'none'; style-src * 'unsafe-inline'; img-src * data: blob:; font-src * data:; media-src *; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-same-origin";

/** Path prefixes (no leading slash) whose routes send their own policy, so the general one must not replace it. */
export const OWN_CSP_PATHS = ["uploads/", "api/files/", "api/blog-preview/"];

/** The request header the proxy passes the page's nonce on (Next reads the nonce from the request's CSP itself). */
export const NONCE_HEADER = "x-nonce";

/** Where browsers send a report of anything the page policy blocked (logged, rate-limited). */
export const CSP_REPORT_PATH = "/api/csp-report";

/**
 * The strict page policy (2026-11-24, the audit's last security item): only
 * scripts this response vouched for run. `src/proxy.ts` makes a fresh nonce
 * for each page and Next puts it on every script it renders; a script an
 * attacker slipped into the HTML has no nonce and doesn't run, nor does an
 * inline `onclick=` or a `javascript:` link.
 *
 * - 'strict-dynamic': a script that carries the nonce may load more scripts
 *   (Next's chunks); host lists are then ignored.
 * - 'self' https: 'unsafe-inline' are fallbacks for browsers too old to know
 *   nonces or 'strict-dynamic'. Every browser that understands a nonce
 *   ignores 'unsafe-inline' when one is present (CSP2), so they don't widen
 *   anything in a current browser.
 * - 'unsafe-eval' in development only: React rebuilds server error stacks
 *   with eval there. Production code never evals (checked in the built
 *   chunks on 2026-11-24).
 *
 * ⚠ Styles stay open: style="" attributes are everywhere and the brand's
 * <style> is inline, and a style can't run code. Don't add style-src with a
 * nonce — a nonce switches 'unsafe-inline' off and every style attribute
 * would be dropped.
 * ⚠ An inline <script> in a component needs `nonce` — or, better, be a client
 * component. Every page renders per request already (the root layout reads
 * the theme cookie), so the nonce costs no static page.
 */
export function pageCsp(nonce: string, opts: { dev?: boolean } = {}): string {
  const script = `script-src 'nonce-${nonce}' 'strict-dynamic' 'self' https: 'unsafe-inline'${opts.dev ? " 'unsafe-eval'" : ""}`;
  return `${BASE_CSP}; ${script}; report-uri ${CSP_REPORT_PATH}`;
}
