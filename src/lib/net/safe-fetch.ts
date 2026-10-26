import { assertPublicHost } from "@/lib/net/public-host";

/**
 * fetch() for an address that came from outside: one a person typed (a feed,
 * a page, an expert's bio, a reference image) or one a page handed us. The
 * server must not become a way into its own network.
 *
 * ⚠ Seven call sites used to do this themselves, and each was missing a piece
 * (audit SEC-13): some checked nothing, redirects were followed without being
 * re-checked (a public page answering 302 → 169.254.169.254 got the metadata
 * service), IPv4-mapped IPv6 and a trailing-dot "localhost." got through, and
 * the RSS prefix check refused real hosts such as fcc.gov and fda.gov. Here:
 * http(s) only, no credentials in the URL, every address the name resolves to
 * must be public (lib/net/public-host.ts), and every redirect hop is checked
 * again before it is followed.
 *
 * Known limit: the name is resolved again by fetch itself, so a hostile DNS
 * server that answers public-then-private (rebinding) is not stopped here.
 */

const HINT = "that address isn't reachable from here";

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/** Parse and vet one address. Throws UnsafeUrlError with a readable reason. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError("That isn't a valid URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UnsafeUrlError("Only http and https addresses can be fetched.");
  if (u.username || u.password) throw new UnsafeUrlError("Addresses with a username or password in them can't be fetched.");
  try {
    await assertPublicHost(u.hostname, HINT);
  } catch (e) {
    throw new UnsafeUrlError(e instanceof Error ? e.message : HINT);
  }
  return u;
}

/**
 * Fetch an outside address, following at most `maxRedirects` redirects and
 * vetting each hop. Same contract as fetch otherwise; `redirect` is always
 * handled here.
 */
export async function safeFetch(
  raw: string,
  init: Omit<RequestInit, "redirect"> & { maxRedirects?: number } = {},
): Promise<Response> {
  const { maxRedirects = 5, ...rest } = init;
  let url = await assertPublicUrl(raw);
  let method = (rest.method ?? "GET").toUpperCase();
  let body = rest.body;
  for (let hop = 0; ; hop++) {
    const res = await fetch(url, { ...rest, method, body, redirect: "manual" });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return res;
    await res.body?.cancel().catch(() => {});
    if (hop >= maxRedirects) throw new UnsafeUrlError("Too many redirects.");
    url = await assertPublicUrl(new URL(location, url).toString());
    // 303, and 301/302 after a POST, continue as a GET without the body (what
    // fetch's own redirect handling does).
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
      method = "GET";
      body = undefined;
    }
  }
}
