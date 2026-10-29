import { NextRequest, NextResponse } from "next/server";
import { PRODUCT } from "@/lib/product";

// Minimal API surface so external clients (incl. MCP servers) can drive
// MeYouSocial. v1 is read-only and exposes channels/scripts/ideas for the authenticated workspace.
// Authentication: a workspace API token (Settings → API tokens) as `Authorization: Bearer mys_…`,
// OR the session cookie when called from a browser (lib/api-auth.ts, E-SEC-16).
//
// Discovery: GET /api/v1 returns the catalog of endpoints.

const CATALOG = {
  name: `${PRODUCT} API`,
  version: "1.0",
  authentication: "Authorization: Bearer <workspace API token from Settings → API tokens> (read or write scope), or the session cookie from a browser.",
  endpoints: [
    { method: "GET", path: "/api/v1/channels",     description: "List channels in the caller's workspace." },
    { method: "GET", path: "/api/v1/scripts",      description: "List scripts (optional ?channelId)." },
    { method: "GET", path: "/api/v1/ideas",        description: "List ideas (optional ?channelId)." },
    { method: "POST", path: "/api/v1/scripts",     description: "Create a draft script with title + channelId (write scope)." },
    { method: "GET", path: "/api/scripts/[id]/export?format=docx|pdf", description: "Export script (auth required)." },
    { method: "GET", path: "/api/scripts/[id]/generate?stage=outline|script", description: "Server-Sent Events streaming generation." },
  ],
  mcp: {
    note: "An MCP server adapter wrapping these endpoints is on the roadmap. Tool names will mirror the endpoint paths above.",
  },
};

export async function GET(_req: NextRequest) {
  return NextResponse.json(CATALOG, { headers: { "Cache-Control": "public, max-age=300" } });
}
