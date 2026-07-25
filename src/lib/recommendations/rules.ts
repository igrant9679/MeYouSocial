import type { Metric, Confidence, TopicPerformance, WorkspaceMetrics } from "@/lib/metrics";

/**
 * The rules.
 *
 * Deliberately DETERMINISTIC, not LLM-authored. The app's truthfulness rules
 * forbid invented metrics, and a model riffing over numbers produces confident
 * prose with no accountable derivation. Every recommendation here is a function
 * of measured values, so its rationale can be checked line by line — and it
 * works with the Anthropic key at $0, which an LLM-authored version would not.
 *
 * Every rule must:
 *   - refuse to fire below its minimum sample (thin data produces silence, not
 *     a confident guess),
 *   - cite the exact metrics it used as `evidence`,
 *   - inherit the confidence of its weakest input.
 */

export type EvidenceItem = { key: string; label: string; value: number | null; sample: number; evidence: string };

export type RuleAction = {
  key: string;
  label: string;
  payload: Record<string, unknown>;
};

export type RuleResult = {
  title: string;
  detail: string;
  rationale: string;
  severity: "info" | "opportunity" | "warning";
  confidence: Confidence;
  evidence: EvidenceItem[];
  /** Stable per finding — dedups regeneration and drives the dismiss cooldown. */
  fingerprint: string;
  action?: RuleAction;
};

export type RuleContext = {
  workspaceId: string;
  metrics: WorkspaceMetrics;
  byKey: Map<string, Metric>;
  topics: TopicPerformance[];
  /** Setup facts the metrics can't express. */
  hasSearchKey: boolean;
  hasAnalytics: boolean;
};

export type Rule = {
  key: string;
  evaluate(ctx: RuleContext): RuleResult | null;
};

const ev = (m: Metric): EvidenceItem => ({
  key: m.key,
  label: m.label,
  value: m.value,
  sample: m.sample,
  evidence: m.evidence,
});

/** The weakest link — a recommendation is never more confident than its inputs. */
function weakest(...items: Confidence[]): Confidence {
  const order: Confidence[] = ["none", "low", "medium", "high"];
  return items.reduce((acc, c) => (order.indexOf(c) < order.indexOf(acc) ? c : acc), "high" as Confidence);
}

// ── Rules ────────────────────────────────────────────────────────────────────

const stalledContent: Rule = {
  key: "stalled_content",
  evaluate({ byKey }) {
    const stalled = byKey.get("wip_stalled");
    const open = byKey.get("wip_open");
    if (!stalled || !open || stalled.value === null || stalled.value < 1) return null;
    const n = stalled.value;
    return {
      title: `${n} post${n === 1 ? "" : "s"} sitting untouched`,
      detail: "Open the Blog board and either move these forward or archive them, so the queue reflects real intent.",
      rationale: `${n} of ${open.value ?? "?"} open posts haven't changed in over two weeks. Stalled drafts quietly inflate WIP and hide how much is genuinely in flight.`,
      severity: "warning",
      confidence: weakest(stalled.confidence, open.confidence),
      evidence: [ev(stalled), ev(open)],
      // Bucket the count so a drift of one doesn't spawn a fresh row every hour.
      fingerprint: `stalled_content:${n >= 10 ? "10+" : n >= 5 ? "5-9" : String(n)}`,
    };
  },
};

const cadenceDeclining: Rule = {
  key: "cadence_declining",
  evaluate({ byKey }) {
    const trend = byKey.get("cadence_trend");
    const cadence = byKey.get("weekly_cadence");
    // The trend metric already refuses to exist without enough on both sides.
    if (!trend || trend.value === null || trend.value > -30) return null;
    return {
      title: "Publishing has slowed",
      detail: "Check whether the drop is deliberate. If not, the Ideas backlog and Automation settings are the two levers.",
      rationale: `Output in the recent half of the window is ${Math.abs(trend.value)}% below the prior half. ${trend.evidence}`,
      severity: "warning",
      confidence: trend.confidence,
      evidence: [ev(trend), ...(cadence ? [ev(cadence)] : [])],
      fingerprint: "cadence_declining",
    };
  },
};

const noSocialDistribution: Rule = {
  key: "no_social_distribution",
  evaluate({ byKey }) {
    const social = byKey.get("social_follow_through");
    // Needs a real denominator: below 3 published posts this says nothing.
    if (!social || social.value === null || social.sample < 3 || social.value >= 50) return null;
    return {
      title: "Published posts aren't reaching social",
      detail: "Generate social variants from a post's Distribute tab, or turn the social function up to assisted so drafts queue automatically.",
      rationale: `Only ${social.value}% of published posts have a posted social variant. ${social.evidence} Writing is the expensive half; distribution is where it pays back.`,
      severity: "opportunity",
      confidence: social.confidence,
      evidence: [ev(social)],
      fingerprint: `no_social_distribution:${social.value < 25 ? "low" : "mid"}`,
    };
  },
};

const ideaBacklog: Rule = {
  key: "idea_backlog",
  evaluate({ byKey }) {
    const conv = byKey.get("idea_to_draft_rate");
    // 8+ ideas before this is a pattern rather than a slow week.
    if (!conv || conv.value === null || conv.sample < 8 || conv.value >= 25) return null;
    return {
      title: "Ideas are piling up unconverted",
      detail: "Draft from the strongest few, or archive the rest so the backlog stays a shortlist rather than a graveyard.",
      rationale: `Only ${conv.value}% of captured ideas became drafts. ${conv.evidence} A backlog that never converts costs review time on every pass.`,
      severity: "opportunity",
      confidence: conv.confidence,
      evidence: [ev(conv)],
      fingerprint: "idea_backlog",
    };
  },
};

/**
 * The one rule with a machine action. Fires when a topic converts materially
 * better than the workspace average, and proposes raising its discovery
 * priority — a nudge to what gets suggested, reversible, destroying nothing.
 */
const topicPriority: Rule = {
  key: "topic_priority",
  evaluate({ topics }) {
    // Only topics with enough posts to mean anything.
    const eligible = topics.filter((t) => t.posts >= 3 && t.publishRate !== null);
    if (eligible.length < 2) return null;

    const totalPosts = eligible.reduce((a, t) => a + t.posts, 0);
    const totalPublished = eligible.reduce((a, t) => a + t.published, 0);
    if (totalPosts < 6 || totalPublished === 0) return null;
    const average = (totalPublished / totalPosts) * 100;

    const best = eligible.reduce((a, t) => ((t.publishRate ?? 0) > (a.publishRate ?? 0) ? t : a));
    // Needs a real gap, not noise.
    if ((best.publishRate ?? 0) < average + 20) return null;

    return {
      title: `“${best.name}” converts best — weight discovery toward it`,
      detail: `Raise the discovery priority of “${best.name}” so idea generation leans on it.`,
      rationale: `${best.name} publishes ${best.publishRate}% of its drafts (${best.published} of ${best.posts}), against a ${Math.round(average)}% average across topics with enough posts to compare. Applying this only reorders what discovery is prompted with — nothing is deleted, and it can be undone by resetting the topic's priority.`,
      severity: "opportunity",
      confidence: best.confidence,
      evidence: [
        {
          key: `topic:${best.topicId}`,
          label: `Publish rate — ${best.name}`,
          value: best.publishRate,
          sample: best.posts,
          evidence: `${best.published} of ${best.posts} posts published, vs ${Math.round(average)}% average.`,
        },
      ],
      fingerprint: `topic_priority:${best.topicId}`,
      action: {
        key: "topic.raise_priority",
        label: `Raise priority of “${best.name}”`,
        payload: { topicId: best.topicId, topicName: best.name, priority: 10 },
      },
    };
  },
};

const slowCycleTime: Rule = {
  key: "slow_cycle_time",
  evaluate({ byKey }) {
    const cycle = byKey.get("cycle_time_days");
    if (!cycle || cycle.value === null || cycle.sample < 3 || cycle.value <= 30) return null;
    return {
      title: "Drafts take a long time to publish",
      detail: "Look at which stage holds posts longest on the Blog board — the gates and review steps are the usual culprits.",
      rationale: `Median time from draft to publish is ${cycle.value} days. ${cycle.evidence}`,
      severity: "info",
      confidence: cycle.confidence,
      evidence: [ev(cycle)],
      fingerprint: "slow_cycle_time",
    };
  },
};

/** Setup gaps — no sample gate, because "nothing is connected" is a certainty. */
const connectAnalytics: Rule = {
  key: "connect_analytics",
  evaluate({ hasAnalytics, metrics }) {
    if (hasAnalytics) return null;
    // Only worth raising once there is content whose performance you'd want.
    const published = metrics.metrics.find((m) => m.key === "posts_published");
    if (!published || (published.value ?? 0) < 1) return null;
    return {
      title: "No search or traffic data connected",
      detail: "Connect Search Console and GA4 under Admin → Analytics so performance stops being a blind spot.",
      rationale:
        "Posts are being published, but nothing measures what they do afterwards. Everything on Insights is currently production-side only — the search and traffic panels stay blank rather than showing zeros.",
      severity: "info",
      confidence: "high",
      evidence: [ev(published)],
      fingerprint: "connect_analytics",
    };
  },
};

const connectSearchKey: Rule = {
  key: "connect_search_key",
  evaluate({ hasSearchKey }) {
    if (hasSearchKey) return null;
    return {
      title: "No search provider configured",
      detail: "Add a Tavily or Serper key under Admin → API keys → Search.",
      rationale:
        "Keyword research, content-gap analysis and external-link suggestions all fall back to mock output without a search key. It is the cheapest unlock for real research input.",
      severity: "info",
      confidence: "high",
      evidence: [],
      fingerprint: "connect_search_key",
    };
  },
};

export const RULES: Rule[] = [
  stalledContent,
  cadenceDeclining,
  noSocialDistribution,
  ideaBacklog,
  topicPriority,
  slowCycleTime,
  connectAnalytics,
  connectSearchKey,
];

/** Actions the engine is allowed to apply WITHOUT a human, in auto mode. */
export const AUTO_APPLICABLE: ReadonlySet<string> = new Set(["topic.raise_priority"]);
