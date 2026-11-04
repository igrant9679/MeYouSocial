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
