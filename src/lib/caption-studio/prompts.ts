/**
 * Caption Studio — the four scenarios from the team's "Caption Prompts &
 * Scenarios" doc (2026-10-17), as prompts the app runs instead of a person
 * pasting them into a chat window.
 *
 * The REQUIREMENTS are the doc's, close to word for word, because they are the
 * team's house style and the doc is where they edit it. Two things are ours:
 *   - the reply is JSON (header, body, two hashtags, and a short version for
 *     X) so the app can lay each caption out, check it, and schedule it,
 *     instead of a person splitting a blob of text by hand;
 *   - the client is grounded from the workspace itself (name, what it does,
 *     audience, brand guardrails, tone) rather than a "[INSERT CLIENT NAME]".
 *
 * The doc's "Format each post like this" is kept as the shape of each item:
 *   [HEADER/TAGLINE]
 *   [MAIN CAPTION]
 *   #Hashtag #Hashtag
 */

export type Scenario = "special_days" | "campaign" | "images" | "countdown";

export const SCENARIOS: Record<Scenario, { label: string; blurb: string }> = {
  special_days: {
    label: "Special days",
    blurb: "A caption for each special day or holiday the client picked — each tied to the client, none generic, none alike.",
  },
  campaign: {
    label: "Weekly campaign",
    blurb: "New posts for a recurring campaign, in the style of its previous captions — never a copy or a close rewording of them.",
  },
  images: {
    label: "From image descriptions",
    blurb: "One caption per picture, built from the description that came with it, in the campaign's established style.",
  },
  countdown: {
    label: "Event countdown",
    blurb: "A connected series for one event — announcements, the countdown, event day and, if wanted, the thank-you.",
  },
};

/** The rules every scenario shares — the doc repeats them in each prompt. */
export const HOUSE_RULES = [
  "Make each caption an appropriate length — not too long and not too short.",
  "Make every caption clearly relevant to the specific client: connect it naturally to the client's organisation, work, audience, values, services or community.",
  "Do not make the captions sound generic or AI-generated; they should feel written specifically for the client.",
  "Make every caption unique from the others. Avoid repeatedly using the same sentence structures, openings, phrases or wording.",
  "Avoid unnecessary repetition of words and expressions across the different posts.",
  "Start each caption with a short, engaging header or tagline, then the main caption.",
  "Add exactly 2 relevant hashtags at the end of each caption.",
  "Do not overuse emojis. Use one only when it naturally fits, and never the same emoji across different captions.",
  "Do not begin captions with “Today we celebrate” or a similar repetitive opening.",
  "Keep the tone natural, professional, warm, engaging and appropriate for the client's audience.",
  "Never invent facts, numbers, statistics, names, quotes or claims that are not in the context given.",
];

const SCENARIO_RULES: Record<Scenario, string[]> = {
  special_days: [
    "Create a separate caption for each selected special day/holiday.",
    "Keep the hashtags relevant to both the special day and the client whenever possible.",
    "If a recommendation or note is provided for a specific holiday, the caption must follow it.",
  ],
  campaign: [
    "Create a separate caption for each new post.",
    "Use the previous captions only as a reference for style, tone, structure and campaign messaging.",
    "Do not copy, repeat or closely reword any previous caption.",
    "Make every new caption unique from the other new captions as well.",
    "Keep the campaign's main purpose and message consistent throughout the new posts.",
    "If the previous captions have a recognisable format or style, keep that general style with fresh wording.",
  ],
  images: [
    "Create a separate caption for each image description, in the same order.",
    "Each caption must directly relate to its image description.",
    "Use the previous captions as a reference for the campaign's tone, style, structure and messaging; do not copy or closely repeat any of them.",
    "Do not add information that cannot reasonably be supported by the image description or the previous campaign context.",
    "Avoid generic captions that could apply to any organisation.",
  ],
  countdown: [
    "Create a separate caption for each requested stage of the countdown, in the order given.",
    "Make the posts feel like one event campaign while making each caption unique.",
    "Communicate the event information where appropriate, but do not repeat the same details in every post.",
    "Make the urgency or purpose of each post fit how close it is to the event, building anticipation as it nears.",
    "Do not use generic or overly repetitive countdown language.",
    "The event-day post must clearly say the event is happening today.",
    "A post-event caption, if requested, focuses on appreciation, participation, community or the event's success.",
  ],
};

export type ClientContext = {
  name: string;
  description?: string | null;
  industry?: string | null;
  audience?: string | null;
  /** brandContextBlock(): differentiators, products, never-say rules. */
  guardrails?: string | null;
  /** motifPromptFor(): the workspace's tone blend. */
  tone?: string | null;
};

export type ScenarioInput =
  | { scenario: "special_days"; days: Array<{ name: string; date: string; note?: string | null }>; notes?: string | null }
  | { scenario: "campaign"; campaign: string; count: number; previous: string[]; notes?: string | null }
  | { scenario: "images"; campaign: string; images: Array<{ description: string }>; previous: string[]; notes?: string | null }
  | { scenario: "countdown"; event: string; stages: string[]; notes?: string | null };

/** How many items a reply must contain, and what each one is called. */
export function expectedItems(input: ScenarioInput): string[] {
  switch (input.scenario) {
    case "special_days": return input.days.map((d) => `${d.name} (${d.date})`);
    case "campaign": return Array.from({ length: input.count }, (_, i) => `Post ${i + 1}`);
    case "images": return input.images.map((_, i) => `Image ${i + 1}`);
    case "countdown": return input.stages;
  }
}

export function buildPrompt(input: ScenarioInput, client: ClientContext): { system: string; user: string } {
  const items = expectedItems(input);
  const system = [
    "You write social media captions for a real organisation, following its house rules exactly.",
    `Respond ONLY with a JSON array of exactly ${items.length} objects, in order, one per item:`,
    '[{"item": string, "header": string, "body": string, "hashtags": [string, string], "x": string}]',
    "- item: the item's label, copied exactly as given.",
    "- header: the short, engaging header or tagline (no hashtags).",
    "- body: the main caption, without the header and without hashtags.",
    "- hashtags: exactly 2, each starting with #, no spaces inside.",
    "- x: a complete version for X (Twitter) of at most 250 characters INCLUDING the same 2 hashtags at the end.",
    "No prose before or after the JSON, no markdown fences, no explanations.",
  ].join("\n");

  const clientBlock = [
    `Client: ${client.name}`,
    client.industry ? `Industry: ${client.industry}` : "",
    client.description ? `What the client does: ${client.description}` : "",
    client.audience ? `Audience: ${client.audience}` : "",
    client.guardrails ?? "",
    client.tone ? `Tone of voice:\n${client.tone}` : "",
  ].filter(Boolean).join("\n");

  let task = "";
  switch (input.scenario) {
    case "special_days":
      task = [
        "Create social media captions for the selected special days/holidays listed below.",
        "Selected Special Days/Holidays:",
        ...input.days.map((d) => `- ${d.name} (${d.date})${d.note ? ` — note: ${d.note}` : ""}`),
        input.notes ? `Client Recommendations/Notes:\n${input.notes}` : "",
      ].filter(Boolean).join("\n");
      break;
    case "campaign":
      task = [
        "Create new social media captions for the recurring weekly campaign below.",
        `Campaign: ${input.campaign}`,
        `Number of New Captions Needed: ${input.count}`,
        input.previous.length ? `Previous Captions for Reference:\n${input.previous.map((p, i) => `--- previous ${i + 1} ---\n${p}`).join("\n")}` : "There are no previous captions yet — establish a fitting style.",
        "Create new captions that follow the same general style, tone, purpose and messaging of the previous captions, but make sure the new captions are clearly different and original.",
        input.notes ? `Notes: ${input.notes}` : "",
      ].filter(Boolean).join("\n");
      break;
    case "images":
      task = [
        "Create one unique caption for each image/file description.",
        `Campaign: ${input.campaign}`,
        "Image descriptions:",
        ...input.images.map((im, i) => `Image ${i + 1}: ${im.description}`),
        input.previous.length ? `Previous Captions for Reference:\n${input.previous.map((p, i) => `--- previous ${i + 1} ---\n${p}`).join("\n")}` : "",
        input.notes ? `Notes: ${input.notes}` : "",
      ].filter(Boolean).join("\n");
      break;
    case "countdown":
      task = [
        "Create a series of social media posts for the event below.",
        `Event:\n${input.event}`,
        "Countdown Posts Needed:",
        ...input.stages.map((s) => `- ${s}`),
        "Create a connected series of captions for this event.",
        input.notes ? `Notes: ${input.notes}` : "",
      ].filter(Boolean).join("\n");
      break;
  }

  const user = [
    clientBlock,
    task,
    `Requirements:\n${[...SCENARIO_RULES[input.scenario], ...HOUSE_RULES].map((r) => `- ${r}`).join("\n")}`,
    `Items, in order (one object each, "item" copied exactly): ${items.map((i) => `"${i}"`).join(", ")}`,
  ].join("\n\n");

  return { system, user };
}
