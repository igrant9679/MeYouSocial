// FR-CHAT-08 — Prompt Library: categorized, ready-made prompts insertable into
// chat and editing. Kept as a flat data file so the UI is purely client-side.

export type PromptEntry = {
  id: string;
  label: string;
  body: string;
};

export type PromptCategory = {
  id: string;
  label: string;
  color: string;
  soft: string;
  prompts: PromptEntry[];
};

export const PROMPT_LIBRARY: PromptCategory[] = [
  {
    id: "ideation",
    label: "Ideation",
    color: "#D97706",
    soft: "#FBEED5",
    prompts: [
      { id: "i1", label: "10 outlier titles in my niche", body: "Generate 10 video title ideas based on outlier videos in my niche and 2 adjacent niches. Each should include a hook, topic, and the psychological reason it'd perform." },
      { id: "i2", label: "Change topic, keep the hook", body: "Take this idea and rewrite it as 3 different videos that preserve the same hook structure but apply it to different topics in my channel's niche." },
      { id: "i3", label: "Find my next outlier", body: "Looking at my recent ideas and audience key questions, suggest 5 angles that are likely to break out and explain why each one is likely to outperform my baseline." },
      { id: "i4", label: "Stress-test this idea", body: "Steel-man and then critique this video idea. What are the 3 reasons it might flop? Then suggest a tweak that addresses each one." },
    ],
  },
  {
    id: "research",
    label: "Research",
    color: "#2563EB",
    soft: "#E5EDFD",
    prompts: [
      { id: "r1", label: "Deep AI research", body: "Do a multi-source research pass on this topic. Synthesize the findings into a structured report: key facts, contested claims, surprising data points, primary sources to cite." },
      { id: "r2", label: "Analyze this YouTube video", body: "Analyze this YouTube video URL: structure breakdown, hook analysis, retention beats, audience reaction signals from comments, and how I could remix the format." },
      { id: "r3", label: "Find counter-evidence", body: "Find counter-evidence and steelman cases against the central claim of this draft. List 5 strongest objections and how I'd address each in the script." },
    ],
  },
  {
    id: "writing",
    label: "Writing",
    color: "#15924B",
    soft: "#E0F2E8",
    prompts: [
      { id: "w1", label: "Punchier hook", body: "Rewrite this opening to make it punchier — shorter sentences, stronger nouns, a sharper promise. Keep my voice." },
      { id: "w2", label: "Cut hedging", body: "Strip all hedging and softeners from this passage. No 'just', 'really', 'sort of', 'I think'. Keep the meaning intact." },
      { id: "w3", label: "More specific", body: "Make this paragraph more specific — replace abstractions with concrete examples, numbers, or named cases." },
      { id: "w4", label: "Add a story", body: "Suggest 3 personal-story openings I could add to this section. Each should be 2-3 sentences and feel naturally embedded in the spoken style." },
      { id: "w5", label: "Smoother transition", body: "Write a 1-2 sentence transition between the section above and the section below that pays off the previous beat and sets up the next one." },
    ],
  },
  {
    id: "structure",
    label: "Structure",
    color: "#6D28D9",
    soft: "#EDE7FB",
    prompts: [
      { id: "s1", label: "Outline this draft", body: "Reverse-engineer an outline from this script. Identify the hook, each section's purpose, the transitions used, and where the retention beats land." },
      { id: "s2", label: "Where does it sag?", body: "Identify the 2-3 places this script loses momentum or repeats itself. Suggest a concrete fix for each (cut, condense, or replace)." },
      { id: "s3", label: "Curiosity-gap audit", body: "Find every place in this script where I could add a curiosity gap, callback, or unresolved question to keep retention high." },
    ],
  },
  {
    id: "packaging",
    label: "Packaging",
    color: "#DB2777",
    soft: "#FBE2EF",
    prompts: [
      { id: "p1", label: "6 title variations", body: "Generate 6 title variations for this video. Each <= 70 chars, distinct angle (curiosity, contrarian, specific, listicle, question, big-claim)." },
      { id: "p2", label: "5 thumbnail concepts", body: "Suggest 5 thumbnail concepts that visually deliver on the title's promise. Describe each as a single sentence of visual brief." },
      { id: "p3", label: "Chapter markers", body: "Estimate YouTube chapter markers (MM:SS Chapter title) from this script at ~150 wpm. Include 4-7 chapters." },
    ],
  },
];

// For the keyboard shortcut hint
export const PROMPT_SHORTCUT = "Ctrl+/";
