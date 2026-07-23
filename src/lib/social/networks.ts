// Networks the social scheduler can target — matches the providers the
// Connections page can connect via Unipile. charLimit powers the composer's
// per-network counter; requiresMedia flags networks that can't post text-only.

export type Network = {
  provider: string;   // Unipile provider (uppercase)
  label: string;
  charLimit: number;
  requiresMedia?: boolean;
  color: string;
};

export const NETWORKS: Network[] = [
  { provider: "LINKEDIN", label: "LinkedIn", charLimit: 3000, color: "#0A66C2" },
  { provider: "X", label: "X (Twitter)", charLimit: 280, color: "#111111" },
  { provider: "INSTAGRAM", label: "Instagram", charLimit: 2200, requiresMedia: true, color: "#E1306C" },
];

export function networkFor(provider: string): Network | undefined {
  return NETWORKS.find((n) => n.provider === provider.toUpperCase());
}

/** The tightest char limit among the chosen providers — what the composer warns against. */
export function tightestLimit(providers: string[]): number {
  const limits = providers.map((p) => networkFor(p)?.charLimit).filter((n): n is number => typeof n === "number");
  return limits.length ? Math.min(...limits) : 3000;
}
