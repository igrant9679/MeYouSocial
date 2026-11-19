import { STAGES, currentTab, stageFor } from "@/lib/stages";

/**
 * What Elsie's pane says about the page it sits beside: its name, and the
 * questions worth asking there. Plain data over lib/stages.ts — safe in client
 * components, no model call.
 *
 * The questions are things her tools can answer from the workspace's own
 * data; `write` marks the ones that end in a change, which a viewer's Elsie
 * can't make and so isn't offered.
 */

/** Every tab a stage can have, whoever is looking — only used to NAME a page, never to link to one. */
const ALL = { channelId: "_", studio: true, admin: true, operator: true } as const;

const OUTSIDE_STAGES: Array<[string, string]> = [
  ["/inbox", "Inbox"],
  ["/notifications", "Notifications"],
  ["/assistant", "Elsie"],
  ["/help", "Help"],
  ["/channels", "Channels"],
  ["/settings", "Your settings"],
  ["/account", "Your account"],
];

/** "Social posts · Queue", "Inbox" — or the path itself where the page has no name here. */
export function elsiePageLabel(pathname: string): string {
  const stage = stageFor(pathname);
  if (stage) {
    const def = STAGES[stage];
    // The stage's own page can sit in a group as a tab (Measure's Summary): it is still just "Measure".
    const tab = currentTab(pathname, def.tabs(ALL).filter((t) => t.href !== stage));
    return tab ? `${def.label} · ${tab.label}` : def.label;
  }
  const hit = OUTSIDE_STAGES.find(([p]) => pathname === p || pathname.startsWith(p + "/"));
  return hit ? hit[1] : pathname;
}

type Prompt = { q: string; write?: boolean };

const BY_STAGE: Record<string, Prompt[]> = {
  "/research": [
    { q: "What are people in our space talking about this week?" },
    { q: "Which competitor videos are outperforming, and what can we learn from them?" },
  ],
  "/ideas": [
    { q: "Which waiting ideas fit our audience best, and why?" },
    { q: "What have we been rejecting, and what does that say about our Topics?" },
    { q: "Find new ideas for our weakest Topic", write: true },
  ],
  // Articles (2026-11-19: the Drafts and Publish stages' prompts, together).
  "/publish": [
    { q: "What should be drafted next, and why that one?" },
    { q: "Draft the next approved idea", write: true },
    { q: "What is ready to go out, and what is holding the rest?" },
    { q: "What is on the calendar for the next two weeks?" },
  ],
  "/distribute": [
    { q: "Is the queue full enough for the next 7 days?" },
    { q: "Which sent post is worth reposting?" },
    { q: "Draft posts for our newest article", write: true },
  ],
  "/studio": [
    { q: "Which script is closest to ready?" },
    { q: "What video should we make next, and why that one?" },
  ],
  "/measure": [
    { q: "What worked best in the last 28 days, and what should we do more of?" },
    { q: "What is losing ground, and what would you do about it?" },
  ],
  "/brand": [
    { q: "Who is our customer, and what have they responded to?" },
    { q: "Summarise our voice and our audience as you understand them" },
  ],
  "/setup": [
    { q: "Is anything in setup still missing?" },
    { q: "Explain what the automation dials are set to right now" },
  ],
};

const ANYWHERE: Prompt[] = [
  { q: "What should I do next?" },
  { q: "What needs my attention?" },
  { q: "What's going out this week?" },
];

/** The questions offered on this page — the page's own first, never more than five. */
export function elsiePrompts(pathname: string, readOnly: boolean): string[] {
  const stage = stageFor(pathname);
  const own = stage ? (BY_STAGE[stage] ?? []) : [];
  const list = stage ? [...own, { q: "Walk me through this page" }, ANYWHERE[0]] : [...ANYWHERE, { q: "Walk me through this page" }];
  return list.filter((p) => !(readOnly && p.write)).map((p) => p.q).slice(0, 5);
}
