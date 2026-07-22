import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// Minimal API surface so external clients (incl. MCP servers) can drive
// MeYouSocial. v1 is read-only and exposes channels/scripts/ideas for the authenticated workspace.
// Authentication: pass `?token=<inviteToken>` where the token is bound to an admin invitation
// of the workspace, OR rely on the session cookie when called from a browser.
//
// Discovery: GET /api/v1 returns the catalog of endpoints.

const CATALOG = {
  name: "MeYouSocial API",
  version: "1.0",
  authentication: "session cookie (browser) or per-workspace token (header X-MeYouSocial-Token).",
  endpoints: [
    { method: "GET", path: "/api/v1/channels",     description: "List channels in the caller's workspace." },
    { method: "GET", path: "/api/v1/scripts",      description: "List scripts (optional ?channelId)." },
    { method: "GET", path: "/api/v1/ideas",        description: "List ideas (optional ?channelId)." },
    { method: "POST", path: "/api/v1/script",      description: "Create a draft script with title + channelId." },
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
