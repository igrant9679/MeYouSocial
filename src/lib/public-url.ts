import { headers } from "next/headers";
import { env } from "@/lib/env";

// Resolves the canonical public origin (e.g. "https://meyousocial.example.com").
//
// Priority:
//   1. The current request's Host / X-Forwarded-Host header — true source of
//      truth when we're inside a server action or server component. Survives
//      domain swaps automatically.
//   2. env.APP_URL — used outside request scope (background jobs, scripts).
//
// Always returns without a trailing slash so callers can append "/path" cleanly.

export async function getPublicUrl(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) {
      const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
      return `${proto}://${host}`.replace(/\/+$/, "");
    }
  } catch {
    // headers() throws outside a request context (background jobs) — fall through.
  }
  return (env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}
