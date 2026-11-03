import type { LeftRailItem } from "@/components/LeftRailNav";

/**
 * The rail, top to bottom — data only, so the help, the guide and the
 * assistant's app map can be built from it (lib/stage-copy.ts, E-SHL-12).
 * The layout filters it by role.
 */
// Each nav item carries its own brand color so the rail reads as a vibrant chip strip
// (mirrors the CreateUp_Mockups.html per-module accent palette).
//
// Grouped by WORKFLOW STAGE since 2026-08-10 (the flat 16-item rail was the
// user's #1 overwhelm complaint) — same hrefs, new order. The stages mirror
// Home's pipeline strip: Research → Create → Distribute → Measure, plus Setup.
// Home and Help stay ungrouped: the first thing and the lifeline both need to
// be visible without a click. Group membership notes:
//  - Chat sits in Research — it's the brainstorm surface, not a writing tool.
//  - Channels sits in Setup: /channels/[id]/ideas|scripts light up the Ideas/
//    Scripts entries (isNavActive's special case), so the day-to-day work
//    reached through a channel still lands in Research/Create.
// THE RAIL IS THE LOOP (One-Loop redesign, step 3, 2026-09-05): Inbox, then
// the seven stages in the order work moves, then Setup. The sixteen module
// pages did not go anywhere — each is a tab inside the stage that owns it
// (see StageHeader), at its unchanged URL. Setup is Admin-only (decision 4).
export const RAIL: (LeftRailItem & { adminOnly?: boolean; editorOnly?: boolean })[] = [
  { href: "/inbox",       label: "Inbox",       icon: "Inbox",         color: "#E5482F", soft: "#FDE7E1" },
  // Editors and admins only: its API is EDITOR-gated, and a viewer's every
  // message failed with "Unexpected token '<'" (ENG-17).
  { href: "/assistant",   label: "Assistant",   icon: "Bot",           color: "#6D28D9", soft: "#EDE7FB", editorOnly: true },
  { href: "/research",    label: "Research",    icon: "Telescope",     color: "#2563EB", soft: "#E5EDFD" },
  { href: "/ideas",       label: "Ideas",       icon: "Sparkles",      color: "#D97706", soft: "#FBEED5" },
  { href: "/drafts",      label: "Drafts",      icon: "PenLine",       color: "#15924B", soft: "#E0F2E8" },
  // ⚠ "Review" left the rail on 2026-09-20 (audit B1.1). It was the Inbox card
  // for card — the same <NeedsYouGroups> over the same data — so the rail held
  // two entries to one screen. Its tabs (Approvals, Audit) are Publish's now.
  { href: "/publish",     label: "Publish",     icon: "Globe",         color: "#21759B", soft: "#E0EDF3" },
  { href: "/distribute",  label: "Distribute",  icon: "Share2",        color: "#0A66C2", soft: "#E5EDFD" },
  { href: "/measure",     label: "Measure",     icon: "LineChart",     color: "#4F46E5", soft: "#E7E6FB" },
  { href: "/setup",       label: "Settings",    icon: "SlidersHorizontal", color: "#6D28D9", soft: "#EDE7FB", group: "Setup", adminOnly: true },
  { href: "/channels",    label: "Channels",    icon: "Layers",        color: "#7C3AED", soft: "#EEE7FC", group: "Setup", adminOnly: true },
  { href: "/brand",       label: "Brand",       icon: "Palette",       color: "#DB2777", soft: "#FBE2EF", group: "Setup", adminOnly: true },
  // ⚠ "Publish Admin" left the rail on 2026-09-20 (audit B1.4). It was the
  // second settings surface — ten tabs beside Settings' four, with People in
  // both and "Connections" naming a different page in each. Its pages are
  // Settings tabs now, at the same /admin/* URLs.
  { href: "/help",        label: "Help",        icon: "HelpCircle",    color: "#0891B2", soft: "#D8EFF5" },
];
