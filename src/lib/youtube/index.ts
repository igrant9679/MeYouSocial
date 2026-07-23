import { env } from "@/lib/env";

// YouTube data interface. Used by Intel, onboarding, voice training,
// chat URL analysis, etc. Mock mode returns plausible fake channels/videos.

export type YTChannelSummary = {
  id: string;            // YouTube channel id
  handle?: string;
  name: string;
  description?: string;
  subscribers: number;
  videoCount: number;
  totalViews: number;
  thumbnailUrl?: string;
  language?: string;
  category?: string;
};

export type YTVideoSummary = {
  id: string;            // YouTube video id
  channelId: string;
  title: string;
  description?: string;
  publishedAt: string;
  durationSeconds: number;
  views: number;
  likes?: number;
  thumbnailUrl?: string;
  format: "short" | "long";
};

export interface YouTubeProvider {
  findChannel(query: string): Promise<YTChannelSummary | null>;
  listVideos(channelId: string, limit?: number): Promise<YTVideoSummary[]>;
  getTranscript(videoId: string): Promise<string | null>;
  searchChannels(query: string, limit?: number): Promise<YTChannelSummary[]>;
}

// ── Mock implementation ────────────────────────────────────────────────────

function seeded(label: string, salt = 0): number {
  let s = salt;
  for (const ch of label) s = (s * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(s);
}

const MOCK_TITLES = [
  "How I changed my mind about X",
  "The truth about productivity",
  "I tried this for 30 days",
  "Why this billion-dollar idea failed",
  "What nobody tells you about Y",
  "Stop doing this. Do this instead.",
  "The hidden pattern behind every great video",
  "I read 100 papers so you don't have to",
  "This single graph changed everything",
  "Inside the world's strangest niche",
];

const mock: YouTubeProvider = {
  async findChannel(query) {
    const handle = query.startsWith("@") ? query : "@" + query.replace(/[^\w]/g, "");
    const s = seeded(handle);
    return {
      id: "UC" + (s.toString(36) + "abcdefghij").slice(0, 22),
      handle,
      name: handle.replace(/^@/, "").replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Sample Channel",
      description: "A demo channel about a fascinating niche. (mock)",
      subscribers: 10_000 + (s % 990_000),
      videoCount: 50 + (s % 450),
      totalViews: 1_000_000 + (s % 50_000_000),
      thumbnailUrl: undefined,
      language: "en",
      category: "Education",
    };
  },
  async listVideos(channelId, limit = 10) {
    const s = seeded(channelId);
    const avgViews = 5_000 + (s % 200_000);
    return Array.from({ length: limit }, (_, i) => {
      const ss = seeded(channelId + ":" + i);
      const multiplier = 0.3 + ((ss % 100) / 20); // 0.3x–5.3x
      return {
        id: ("v" + ss.toString(36)).slice(0, 11),
        channelId,
        title: MOCK_TITLES[ss % MOCK_TITLES.length],
        publishedAt: new Date(Date.now() - i * 7 * 24 * 60 * 60 * 1000).toISOString(),
        durationSeconds: 180 + (ss % 1500),
        views: Math.round(avgViews * multiplier),
        likes: Math.round(avgViews * multiplier * 0.03),
        format: ss % 6 === 0 ? "short" : "long",
      } satisfies YTVideoSummary;
    });
  },
  async getTranscript(videoId) {
    return `(mock transcript for ${videoId}) — In this video we explore a topic, set up the problem, explain the mechanism, and apply it. Replace USE_MOCK_YOUTUBE=false and supply a YOUTUBE_API_KEY to fetch real transcripts.`;
  },
  async searchChannels(query, limit = 8) {
    return Promise.all(Array.from({ length: limit }, (_, i) => mock.findChannel(query + "-" + i))).then((xs) =>
      xs.filter((x): x is YTChannelSummary => x !== null),
    );
  },
};

// ── Real implementation: not wired yet; flip env.USE_MOCK_YOUTUBE=false and
// a real adapter (using process.env.YOUTUBE_API_KEY) will go here.

// ── Real implementation (YouTube Data API v3, key-based) ────────────────────
// Read-only surface: search/channels/playlistItems/videos. getTranscript stays
// null — caption download needs OAuth, not an API key; the callers already
// handle null transcripts gracefully.

const YT = "https://www.googleapis.com/youtube/v3";

async function ytGet<T>(path: string, params: Record<string, string>): Promise<T> {
  // DB-first key (Admin → API keys → YouTube), env fallback — same pattern as
  // every other provider, so admins never need Railway access.
  const { getApiKey } = await import("@/lib/llm/keys");
  const key = (await getApiKey("youtube")) || env.YOUTUBE_API_KEY;
  const qs = new URLSearchParams({ ...params, key });
  const res = await fetch(`${YT}/${path}?${qs}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`YouTube API ${path} HTTP ${res.status}`);
  return (await res.json()) as T;
}

function parseDuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] ?? "0", 10) * 3600) + (parseInt(m[2] ?? "0", 10) * 60) + parseInt(m[3] ?? "0", 10);
}

type YtChannelItem = {
  id: string;
  snippet?: { title?: string; description?: string; customUrl?: string; thumbnails?: { default?: { url?: string } }; defaultLanguage?: string };
  statistics?: { subscriberCount?: string; videoCount?: string; viewCount?: string };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
};

function toChannelSummary(c: YtChannelItem): YTChannelSummary {
  return {
    id: c.id,
    handle: c.snippet?.customUrl,
    name: c.snippet?.title ?? "Unknown channel",
    description: c.snippet?.description,
    subscribers: parseInt(c.statistics?.subscriberCount ?? "0", 10),
    videoCount: parseInt(c.statistics?.videoCount ?? "0", 10),
    totalViews: parseInt(c.statistics?.viewCount ?? "0", 10),
    thumbnailUrl: c.snippet?.thumbnails?.default?.url,
    language: c.snippet?.defaultLanguage,
  };
}

const real: YouTubeProvider = {
  async searchChannels(query, limit = 5) {
    const search = await ytGet<{ items?: Array<{ id?: { channelId?: string } }> }>("search", {
      part: "snippet", type: "channel", q: query, maxResults: String(Math.min(limit, 10)),
    });
    const ids = (search.items ?? []).map((i) => i.id?.channelId).filter((x): x is string => !!x);
    if (!ids.length) return [];
    const channels = await ytGet<{ items?: YtChannelItem[] }>("channels", {
      part: "snippet,statistics", id: ids.join(","),
    });
    return (channels.items ?? []).map(toChannelSummary);
  },
  async findChannel(query) {
    const list = await real.searchChannels(query, 1);
    return list[0] ?? null;
  },
  async listVideos(channelId, limit = 20) {
    const ch = await ytGet<{ items?: YtChannelItem[] }>("channels", {
      part: "contentDetails", id: channelId,
    });
    const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) return [];
    const pl = await ytGet<{ items?: Array<{ contentDetails?: { videoId?: string } }> }>("playlistItems", {
      part: "contentDetails", playlistId: uploads, maxResults: String(Math.min(limit, 50)),
    });
    const ids = (pl.items ?? []).map((i) => i.contentDetails?.videoId).filter((x): x is string => !!x);
    if (!ids.length) return [];
    const vids = await ytGet<{
      items?: Array<{
        id: string;
        snippet?: { title?: string; description?: string; publishedAt?: string; thumbnails?: { medium?: { url?: string } } };
        statistics?: { viewCount?: string; likeCount?: string };
        contentDetails?: { duration?: string };
      }>;
    }>("videos", { part: "snippet,statistics,contentDetails", id: ids.join(",") });
    return (vids.items ?? []).map((v) => {
      const seconds = parseDuration(v.contentDetails?.duration ?? "");
      return {
        id: v.id,
        channelId,
        title: v.snippet?.title ?? "Untitled",
        description: v.snippet?.description,
        publishedAt: v.snippet?.publishedAt ?? new Date().toISOString(),
        durationSeconds: seconds,
        views: parseInt(v.statistics?.viewCount ?? "0", 10),
        likes: v.statistics?.likeCount ? parseInt(v.statistics.likeCount, 10) : undefined,
        thumbnailUrl: v.snippet?.thumbnails?.medium?.url,
        format: seconds > 0 && seconds <= 90 ? ("short" as const) : ("long" as const),
      };
    });
  },
  async getTranscript() {
    return null; // caption download needs OAuth; callers handle null.
  },
};

// Provider resolution is per-call: a key pasted in-app activates the real API
// within ~30s (key cache TTL) with no redeploy. USE_MOCK_YOUTUBE=true forces
// the mock regardless — the explicit off-switch for testing.
export const youtube: YouTubeProvider = {
  async findChannel(query) {
    return (await pick()).findChannel(query);
  },
  async listVideos(channelId, limit) {
    return (await pick()).listVideos(channelId, limit);
  },
  async getTranscript(videoId) {
    return (await pick()).getTranscript(videoId);
  },
  async searchChannels(query, limit) {
    return (await pick()).searchChannels(query, limit);
  },
};

async function pick(): Promise<YouTubeProvider> {
  if (env.USE_MOCK_YOUTUBE) return mock;
  try {
    const { getApiKey } = await import("@/lib/llm/keys");
    const key = (await getApiKey("youtube")) || env.YOUTUBE_API_KEY;
    return key ? real : mock;
  } catch {
    return env.YOUTUBE_API_KEY ? real : mock;
  }
}
