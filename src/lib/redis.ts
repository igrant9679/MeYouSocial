import net from "node:net";
import tls from "node:tls";

/**
 * A minimal, dependency-free Redis client.
 *
 * Hand-rolled for the same reason `storage/gdrive.ts` and
 * `branded-video/heygen-cloud.ts` are: this needs exactly six commands
 * (AUTH, PING, SET, GET, DEL, EVAL) on one connection, and pulling in a full
 * client for that is a lot of surface area — and build weight — for very
 * little. RESP2 is a small, stable, well-specified protocol.
 *
 * Scope, stated plainly so nobody mistakes this for a general client:
 *   - RESP2 only. No pub/sub, pipelining, cluster, sentinel or reconnect.
 *   - One command in flight at a time, serialised through a promise chain.
 *   - Every call is bounded by a timeout; a hung socket can never wedge a
 *     caller, which matters because the only consumer is a scheduler lock.
 * If it ever needs more than this, swap it for `ioredis` rather than growing it.
 */

export type RedisTarget = { host: string; port: number; username?: string; password?: string; tls: boolean };

/** Parse `redis://[user:pass@]host:port` (or `rediss://` for TLS). */
export function parseRedisUrl(raw: string): RedisTarget | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "redis:" && u.protocol !== "rediss:") return null;
    const port = u.port ? Number(u.port) : 6379;
    if (!u.hostname || !Number.isFinite(port)) return null;
    return {
      host: u.hostname,
      port,
      // Redis' default user is "default"; an empty username with a password set
      // is the common `redis://:pass@host` form and must still authenticate.
      username: decodeURIComponent(u.username || "") || undefined,
      password: decodeURIComponent(u.password || "") || undefined,
      tls: u.protocol === "rediss:",
    };
  } catch {
    return null;
  }
}

/** RESP value: string | number | null | nested array. */
export type RespValue = string | number | null | RespValue[];

/** Encode a command as a RESP array of bulk strings. */
function encode(args: (string | number)[]): Buffer {
  const parts: Buffer[] = [Buffer.from(`*${args.length}\r\n`)];
  for (const a of args) {
    const b = Buffer.from(String(a));
    parts.push(Buffer.from(`$${b.length}\r\n`), b, Buffer.from("\r\n"));
  }
  return Buffer.concat(parts);
}

/**
 * Incremental RESP2 reader.
 *
 * Returns `undefined` when the buffer holds an incomplete reply, which is the
 * signal to wait for more bytes — distinct from `null`, which is a real Redis
 * nil. Conflating those two is the classic bug in a hand-written parser, so
 * they are deliberately different types here.
 */
function decode(buf: Buffer, start: number): { value: RespValue; next: number } | undefined {
  if (start >= buf.length) return undefined;
  const crlf = buf.indexOf("\r\n", start);
  if (crlf === -1) return undefined;
  const type = buf[start];
  const head = buf.toString("utf8", start + 1, crlf);
  const after = crlf + 2;

  switch (type) {
    case 0x2b: // '+' simple string
      return { value: head, next: after };
    case 0x2d: // '-' error
      throw new RedisError(head);
    case 0x3a: // ':' integer
      return { value: Number(head), next: after };
    case 0x24: { // '$' bulk string
      const len = Number(head);
      if (len === -1) return { value: null, next: after };
      if (buf.length < after + len + 2) return undefined;
      return { value: buf.toString("utf8", after, after + len), next: after + len + 2 };
    }
    case 0x2a: { // '*' array
      const count = Number(head);
      if (count === -1) return { value: null, next: after };
      const items: RespValue[] = [];
      let cursor = after;
      for (let i = 0; i < count; i++) {
        const item = decode(buf, cursor);
        if (!item) return undefined;
        items.push(item.value);
        cursor = item.next;
      }
      return { value: items, next: cursor };
    }
    default:
      throw new RedisError(`Unsupported RESP type '${String.fromCharCode(type)}'`);
  }
}

export class RedisError extends Error {}

const CONNECT_TIMEOUT_MS = 5_000;
const COMMAND_TIMEOUT_MS = 5_000;

export class RedisClient {
  private socket: net.Socket | null = null;
  private buffer = Buffer.alloc(0);
  private pending: { resolve: (v: RespValue) => void; reject: (e: Error) => void } | null = null;
  /** Serialises commands: one in flight, the rest queued behind this promise. */
  private chain: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(private target: RedisTarget) {}

  private connect(): Promise<net.Socket> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this.socket);
    return new Promise((resolve, reject) => {
      const onFail = (e: Error) => { cleanup(); reject(e); };
      const sock = this.target.tls
        ? tls.connect({ host: this.target.host, port: this.target.port, servername: this.target.host })
        : net.connect({ host: this.target.host, port: this.target.port });

      const timer = setTimeout(() => onFail(new Error(`Redis connect timed out after ${CONNECT_TIMEOUT_MS}ms`)), CONNECT_TIMEOUT_MS);
      const cleanup = () => { clearTimeout(timer); sock.removeListener("error", onFail); };

      sock.once("error", onFail);
      sock.once(this.target.tls ? "secureConnect" : "connect", () => {
        cleanup();
        sock.setNoDelay(true);
        sock.on("data", (chunk) => this.onData(chunk));
        // A dropped connection must fail the in-flight command rather than
        // leaving its promise pending forever.
        sock.on("error", (e) => this.fail(e));
        sock.on("close", () => { this.socket = null; this.fail(new Error("Redis connection closed")); });
        this.socket = sock;
        resolve(sock);
      });
    });
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    // Drain every complete reply the buffer now holds.
    for (;;) {
      const waiter = this.pending;
      if (!waiter) return;
      let parsed;
      try {
        parsed = decode(this.buffer, 0);
      } catch (e) {
        this.buffer = Buffer.alloc(0);
        this.pending = null;
        waiter.reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      if (!parsed) return; // incomplete — wait for more bytes
      this.buffer = this.buffer.subarray(parsed.next);
      this.pending = null;
      waiter.resolve(parsed.value);
    }
  }

  private fail(e: Error) {
    const waiter = this.pending;
    this.pending = null;
    waiter?.reject(e);
  }

  /** Send one command. Serialised, timeout-bounded. */
  async command(...args: (string | number)[]): Promise<RespValue> {
    if (this.closed) throw new RedisError("client is closed");
    const run = async (): Promise<RespValue> => {
      const sock = await this.connect();
      if (!this.authed) await this.authenticate(sock);
      return this.send(sock, args);
    };
    // Chain regardless of the previous command's outcome, so one failure
    // doesn't poison every subsequent call.
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => undefined);
    return result;
  }

  private authed = false;

  private async authenticate(sock: net.Socket) {
    if (this.target.password) {
      const args = this.target.username
        ? ["AUTH", this.target.username, this.target.password]
        : ["AUTH", this.target.password];
      await this.send(sock, args);
    }
    this.authed = true;
  }

  private send(sock: net.Socket, args: (string | number)[]): Promise<RespValue> {
    return new Promise<RespValue>((resolve, reject) => {
      const timer = setTimeout(() => {
        // The reply may still arrive later and would desync the stream, so the
        // socket is dropped rather than reused.
        this.pending = null;
        sock.destroy();
        this.socket = null;
        this.authed = false;
        reject(new Error(`Redis command timed out after ${COMMAND_TIMEOUT_MS}ms`));
      }, COMMAND_TIMEOUT_MS);
      this.pending = {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      };
      sock.write(encode(args), (e) => { if (e) this.fail(e); });
    });
  }

  async ping(): Promise<string> {
    return String(await this.command("PING"));
  }

  close() {
    this.closed = true;
    this.authed = false;
    this.socket?.destroy();
    this.socket = null;
  }
}

/** Process-wide client, created lazily from REDIS_URL. */
let shared: RedisClient | null | undefined;

export function getRedis(): RedisClient | null {
  if (shared !== undefined) return shared;
  const target = parseRedisUrl(process.env.REDIS_URL ?? "");
  shared = target ? new RedisClient(target) : null;
  return shared;
}

/** Testing seam — lets a probe point at an explicit URL. */
export function setSharedRedis(client: RedisClient | null) {
  shared = client;
}
