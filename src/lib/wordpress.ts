// WordPress REST adapter (ported from Spark's lib/wordpress.ts, slice-4 scope:
// connection test + post create). Uses application passwords over Basic auth.

export type WpCredentials = { baseUrl: string; username: string; appPassword: string };

function authHeader(c: WpCredentials): string {
  return "Basic " + Buffer.from(`${c.username}:${c.appPassword}`).toString("base64");
}

function api(c: WpCredentials, path: string): string {
  return c.baseUrl.replace(/\/+$/, "") + "/wp-json/wp/v2" + path;
}

/** Verify credentials by fetching the authenticated user. */
export async function wpTestConnection(c: WpCredentials): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(api(c, "/users/me"), {
      headers: { Authorization: authHeader(c) },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status} from /users/me` };
    const me = (await res.json()) as { name?: string };
    return { ok: true, detail: `Authenticated as ${me.name ?? c.username}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "connection failed" };
  }
}

export type WpPublishInput = {
  title: string;
  slug?: string | null;
  content: string;
  excerpt?: string | null; // meta description
  status: "draft" | "publish";
};

/** Create the post. Returns the WP post id + public link. */
export async function wpCreatePost(
  c: WpCredentials,
  input: WpPublishInput,
): Promise<{ id: number; link: string }> {
  const res = await fetch(api(c, "/posts"), {
    method: "POST",
    headers: { Authorization: authHeader(c), "Content-Type": "application/json" },
    body: JSON.stringify({
      title: input.title,
      slug: input.slug ?? undefined,
      content: input.content,
      excerpt: input.excerpt ?? undefined,
      status: input.status,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`WordPress rejected the post (HTTP ${res.status}): ${body.slice(0, 200)}`);
  }
  const post = (await res.json()) as { id: number; link: string };
  return { id: post.id, link: post.link };
}
