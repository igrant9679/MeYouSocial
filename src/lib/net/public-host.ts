import { isIP } from "node:net";

/**
 * Is this host on the public internet? For any server-side connection to a
 * host a tenant typed (SMTP today; the shared fetch guard builds on it).
 *
 * Refuses loopback, private, link-local (cloud metadata lives at
 * 169.254.169.254), carrier-grade NAT, unique-local and IPv4-mapped IPv6 —
 * checking EVERY address the name resolves to, so a public-looking name that
 * points inside the network is refused too. Prefix checks apply to IP
 * literals only (fcc.gov is a real public host).
 */

function ipv4Private(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) ||           // link-local / metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||             // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224                              // multicast + reserved
  );
}

function ipv6Private(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v === "::" || v === "::1") return true;
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4Private(mapped[1]);
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(v)) return true; // mapped, hex form
  const first = parseInt(v.split(":")[0] || "0", 16);
  return (
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unique-local
    (first & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (first & 0xff00) === 0xff00 || // multicast
    v.startsWith("64:ff9b:") ||    // NAT64 can reach IPv4 internals
    v.startsWith("2001:db8:")      // documentation
  );
}

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip.replace(/^\[|\]$/g, ""));
  if (kind === 4) return ipv4Private(ip);
  if (kind === 6) return ipv6Private(ip);
  return true;
}

/** Throws a readable error unless every address of `host` is public. */
export async function assertPublicHost(host: string): Promise<void> {
  const h = host.trim().replace(/\.$/, "").toLowerCase();
  if (!h) throw new Error("No host given.");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local") || h.endsWith(".railway.internal")) {
    throw new Error(`"${host}" is an internal address — use your mail provider's public server name`);
  }
  if (isIP(h.replace(/^\[|\]$/g, ""))) {
    if (isPrivateAddress(h)) throw new Error(`"${host}" is a private address — use your mail provider's public server name`);
    return;
  }
  const { lookup } = await import("node:dns/promises");
  let addrs: Array<{ address: string }>;
  try {
    addrs = await lookup(h, { all: true, verbatim: true });
  } catch {
    throw new Error(`"${host}" doesn't resolve — check the server name`);
  }
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new Error(`"${host}" points to a private address — use your mail provider's public server name`);
  }
}
