import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";

/**
 * Versions of a channel's voice profiles and its audience avatar (E-SET-07).
 * Re-training or editing either used to overwrite it in place: a refine that
 * went wrong, or a refresh from YouTube over a hand-written avatar, could not
 * be taken back. Now every change saves the state it produced (`saveVersion`),
 * and any version can be compared with the current one and restored.
 *
 * A snapshot is the profile's own content: a voice's `data` without its
 * scratch keys (`_preview`, `_lastInstruction`… — the page's working notes, not
 * the voice), an avatar's five sections. Writing samples feed training; they
 * are not part of a version.
 */

export type ProfileKind = "voice" | "audience";
export type Snapshot = Record<string, unknown>;

/** Versions kept per profile; the oldest go first. */
export const VERSIONS_KEPT = 30;

export const AUDIENCE_SECTIONS = ["demographics", "psychographics", "onlineBehavior", "offlineBehavior", "keyQuestions"] as const;

/** A voice's content: its data without the "_" scratch keys. */
export function voiceSnapshot(data: string | null | undefined): Snapshot {
  const all = readJson<Snapshot>(data ?? "{}", {});
  return Object.fromEntries(Object.entries(all).filter(([k]) => !k.startsWith("_")));
}

/** An avatar's content: its five sections, parsed. */
export function audienceSnapshot(a: Partial<Record<(typeof AUDIENCE_SECTIONS)[number], string | null>>): Snapshot {
  return Object.fromEntries(AUDIENCE_SECTIONS.map((k) => [k, readJson<unknown>(a[k] ?? (k === "keyQuestions" ? "[]" : "{}"), null)]));
}

/** Stable JSON: keys sorted at every level, so equal content compares equal. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

/** Leaves by dotted path; arrays are one leaf (a list reads as a list). */
function leaves(v: unknown, at = "", out = new Map<string, string>()): Map<string, string> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const entries = Object.entries(v as Record<string, unknown>);
    if (!entries.length && at) out.set(at, "{}");
    for (const [k, x] of entries) leaves(x, at ? `${at}.${k}` : k, out);
  } else if (at) {
    out.set(at, Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : stableJson(x))).join(" · ") : typeof v === "string" ? v : stableJson(v));
  }
  return out;
}

export type FieldChange = { field: string; before: string | null; after: string | null };

/** What differs between two snapshots, field by field — for Compare. */
export function diffSnapshots(before: Snapshot, after: Snapshot): FieldChange[] {
  const a = leaves(before), b = leaves(after);
  const out: FieldChange[] = [];
  for (const field of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const x = a.get(field) ?? null, y = b.get(field) ?? null;
    if (x !== y) out.push({ field, before: x, after: y });
  }
  return out;
}

/**
 * Keep the state a change produced. Nothing is saved when it equals the latest
 * version (a save that changed nothing isn't a version). When a profile has no
 * versions yet, `before` — the state the change started from — is kept first
 * as "As it was", so the very first change can be undone too.
 */
export async function saveVersion(opts: {
  kind: ProfileKind;
  profileId: string;
  channelId: string;
  snapshot: Snapshot;
  label: string;
  userId?: string | null;
  before?: Snapshot | null;
}): Promise<void> {
  const latest = await db.profileVersion.findFirst({
    where: { kind: opts.kind, profileId: opts.profileId },
    orderBy: { createdAt: "desc" },
    select: { snapshot: true },
  });
  if (!latest && opts.before && stableJson(opts.before) !== stableJson(opts.snapshot)) {
    await db.profileVersion.create({
      data: { kind: opts.kind, profileId: opts.profileId, channelId: opts.channelId, snapshot: JSON.stringify(opts.before), label: "As it was", createdAt: new Date(Date.now() - 1000) },
    });
  }
  if (latest && stableJson(readJson<Snapshot>(latest.snapshot, {})) === stableJson(opts.snapshot)) return;
  await db.profileVersion.create({
    data: { kind: opts.kind, profileId: opts.profileId, channelId: opts.channelId, snapshot: JSON.stringify(opts.snapshot), label: opts.label.slice(0, 200), createdById: opts.userId ?? null },
  });
  const old = await db.profileVersion.findMany({
    where: { kind: opts.kind, profileId: opts.profileId },
    orderBy: { createdAt: "desc" },
    skip: VERSIONS_KEPT,
    select: { id: true },
  });
  if (old.length) await db.profileVersion.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
}

export type VersionRow = { id: string; n: number; label: string; createdAt: Date; by: string | null; snapshot: Snapshot; changes: FieldChange[] };

/**
 * A profile's versions, newest first, numbered from the oldest kept (1), each
 * with what it differs in from the CURRENT state (empty = it is the current).
 */
export async function listVersions(kind: ProfileKind, profileId: string, current: Snapshot): Promise<VersionRow[]> {
  const rows = await db.profileVersion.findMany({
    where: { kind, profileId },
    orderBy: { createdAt: "asc" },
    select: { id: true, label: true, createdAt: true, createdById: true, snapshot: true },
  });
  const people = new Map(
    (await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById).filter((v): v is string => !!v))] } }, select: { id: true, name: true, email: true } }))
      .map((u) => [u.id, u.name ?? u.email ?? null]),
  );
  return rows
    .map((r, i) => {
      const snapshot = readJson<Snapshot>(r.snapshot, {});
      return { id: r.id, n: i + 1, label: r.label, createdAt: r.createdAt, by: r.createdById ? people.get(r.createdById) ?? null : null, snapshot, changes: diffSnapshots(current, snapshot) };
    })
    .reverse();
}

/** Pull the JSON object out of a model's answer; null when there isn't one. */
export function jsonObjectFrom(text: string): Snapshot | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Snapshot) : null;
  } catch {
    return null;
  }
}
