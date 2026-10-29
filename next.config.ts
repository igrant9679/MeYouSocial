import type { NextConfig } from "next";

/**
 * Defence in depth on every response (E-SEC-02). Only the directives that can't
 * break a page here: no plugins, no <base> hijack, no framing by another site,
 * no MIME sniffing, no referrer path to other origins, no camera / microphone /
 * location / payment. script-src, style-src and connect-src stay open: Next's
 * own inline scripts would need a per-request nonce, which means rendering every
 * page dynamically — that strict policy is a separate step. Stored files add
 * their own sandbox CSP on top (lib/storage's routes); both apply.
 */
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "object-src 'none'; base-uri 'self'; frame-ancestors 'self'" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  // pdfkit reads its font metrics (.afm files) from disk at runtime — bundling
  // it breaks those reads, so it stays an external package (node_modules is
  // present in the runtime container).
  // ffmpeg-static exports the path of a binary that sits inside its own package
  // directory — bundling it rewrites that path and the spawn fails.
  serverExternalPackages: ["pdfkit", "ffmpeg-static"],
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
