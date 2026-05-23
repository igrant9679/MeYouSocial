// Constants used by the Script Builder Classic actions and pages.
// Kept out of the "use server" actions file because Next requires those to
// export only async functions.

export const RESEARCH_DEPTHS = {
  basic:         { label: "Basic",         words: 5_000 },
  intermediate:  { label: "Intermediate",  words: 15_000 },
  comprehensive: { label: "Comprehensive", words: 45_000 },
  exhaustive:    { label: "Exhaustive",    words: 90_000 },
} as const;
