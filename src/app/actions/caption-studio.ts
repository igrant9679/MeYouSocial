"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { readJson, writeJson } from "@/lib/db/json";
import { writeAudit } from "@/lib/governance";
import { networkFor } from "@/lib/social/networks";
import { addCategory } from "@/lib/social/categories";
import { claimNextFreeSlot, getPostingTimeZone, queueFailureMessage } from "@/lib/social/slots";
import { generateCaptions } from "@/lib/caption-studio/generate";
import { assemble, checkBatch, type CaptionItem, type Flag } from "@/lib/caption-studio/checks";
import { SCENARIOS, type Scenario, type ScenarioInput } from "@/lib/caption-studio/prompts";
import { countdownDays, dayAt, parsePostAt, COUNTDOWN_STAGES, type StageKey } from "@/lib/caption-studio/timing";
import { isValidDay, monthRange, nextYearDay, parsePastedDays } from "@/lib/caption-studio/special-days";

// Caption Studio — the team's "Caption Prompts & Scenarios" doc as a flow
// in the app (Socialmonials parity, phase 3, 2026-10-17). Nothing generated
// here reaches a network until a person reviews the batch and saves it.

export type BatchItem = CaptionItem & {
  flags: Flag[];
  /** Calendar day in the posting timezone, or null (campaign / images). */
  day: string | null;
  /** Minute of the day to post at. */
  minute: number;
  include: boolean;
  mediaKey: string | null;
  specialDayId: string | null;
  postId: string | null;
  /** The proposed day was already behind us when the batch was made. */
  past?: boolean;
};

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MEDIA_BYTES = 15 * 1024 * 1024;
const X_LIMIT = 280;

function studio(params: Record<string, string>, msg?: { ok?: string; err?: string }): never {
  const q = new URLSearchParams(params);
  if (msg?.ok) q.set("ok", msg.ok);
  if (msg?.err) q.set("err", msg.err);
  redirect(`/social/captions?${q.toString()}`);
}

async function storeImage(f: FormDataEntryValue | null, workspaceId: string): Promise<string | null> {
  if (!(f instanceof File) || f.size === 0) return null;
  if (!IMAGE_TYPES.has(f.type)) throw new Error("Only PNG, JPEG, GIF or WebP images are supported.");
  if (f.size > MEDIA_BYTES) throw new Error("Each image must be under 15 MB.");
  const stored = await storage.put(f.name, Buffer.from(await f.arrayBuffer()), f.type, workspaceId);
  return stored.key;
}

// ── Special days (the doc's steps 1–4) ─────────────────────────────────────

export async function addSpecialDayAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const month = String(formData.get("month") ?? "");
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const day = String(formData.get("day") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim().slice(0, 500) || null;
  if (!name || !isValidDay(day)) studio({ s: "special_days", month }, { err: "Give the day a name and a valid date." });
  await db.specialDay.upsert({
    where: { workspaceId_day_name: { workspaceId: workspace.id, day, name } },
    update: { note },
    create: { workspaceId: workspace.id, name, day, note, verified: true, source: "manual" },
  });
  revalidatePath("/social/captions");
  studio({ s: "special_days", month: day.slice(0, 7) }, { ok: `Added ${name}.` });
}

export async function pasteSpecialDaysAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const month = String(formData.get("month") ?? "");
  const range = monthRange(month);
  if (!range) studio({ s: "special_days" }, { err: "Pick a month first." });
  const { days, unreadable } = parsePastedDays(String(formData.get("text") ?? "").slice(0, 20_000), range.year);
  const r = days.length
    ? await db.specialDay.createMany({
        data: days.map((d) => ({ workspaceId: workspace.id, name: d.name, day: d.day, note: d.note, verified: true, source: "pasted" })),
        skipDuplicates: true,
      })
    : { count: 0 };
  revalidatePath("/social/captions");
  const msg = `Added ${r.count} special day${r.count === 1 ? "" : "s"}${days.length > r.count ? ` (${days.length - r.count} already on the list)` : ""}.${unreadable.length ? ` Couldn't read a date in ${unreadable.length} line${unreadable.length === 1 ? "" : "s"}: “${unreadable.slice(0, 3).join("”, “")}”${unreadable.length > 3 ? "…" : ""} — add those with their date.` : ""}`;
  studio({ s: "special_days", month }, r.count || !unreadable.length ? { ok: msg } : { err: msg });
}

/**
 * The doc's "use the previous year's list as a reference": last year's days
 * for this month, copied forward to the same month and day — UNVERIFIED,
 * because many observances move. The list says which ones still need a check.
 */
export async function rollForwardAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const month = String(formData.get("month") ?? "");
  const range = monthRange(month);
  if (!range) studio({ s: "special_days" }, { err: "Pick a month first." });
  const lastYear = `${range.year - 1}${month.slice(4)}`;
  const prev = monthRange(lastYear)!;
  const rows = await db.specialDay.findMany({ where: { workspaceId: workspace.id, day: { gte: prev.from, lte: prev.to } } });
  const copies = rows.map((r) => ({ r, next: nextYearDay(r.day) }));
  const noTwin = copies.filter((c) => !c.next).map((c) => c.r.name);
  const res = await db.specialDay.createMany({
    data: copies.filter((c) => c.next).map((c) => ({ workspaceId: workspace.id, name: c.r.name, day: c.next!, note: c.r.note, verified: false, source: "rolled" })),
    skipDuplicates: true,
  });
  revalidatePath("/social/captions");
  studio({ s: "special_days", month }, rows.length
    ? { ok: `Copied ${res.count} day${res.count === 1 ? "" : "s"} from ${prev.label} — each is marked “check the date”, since observances move.${noTwin.length ? ` ${noTwin.join(", ")} fell on 29 February and has no date this year.` : ""}` }
    : { err: `Nothing on the list for ${prev.label} to copy forward.` });
}

export async function updateSpecialDayAction(formData: FormData) {
  const { workspace, user } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  const month = String(formData.get("month") ?? "");
  const row = await db.specialDay.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!row) studio({ s: "special_days", month }, { err: "That day isn't on this workspace's list." });
  const selected = String(formData.get("selected") ?? "") === "on";
  const verified = String(formData.get("verified") ?? "") === "on";
  const note = String(formData.get("note") ?? "").trim().slice(0, 500) || null;
  const day = String(formData.get("day") ?? row.day).trim();
  await db.specialDay.update({
    where: { id: row.id },
    data: {
      selected,
      verified: day !== row.day ? true : verified,
      note,
      ...(isValidDay(day) && day !== row.day ? { day } : {}),
      ...(selected && !row.selected ? { selectedBy: user.name ?? user.email, selectedAt: new Date() } : {}),
      ...(!selected ? { selectedBy: null, selectedAt: null } : {}),
    },
  });
  revalidatePath("/social/captions");
  studio({ s: "special_days", month }, { ok: `Saved ${row.name}.` });
}

// ── Generate a batch ────────────────────────────────────────────────────────

/** "a\n---\nb" → ["a","b"]; a paste with no separator is one caption. */
function splitPasted(raw: string): string[] {
  return raw.split(/\r?\n\s*-{3,}\s*\r?\n/).map((s) => s.trim()).filter((s) => s.length > 10).slice(0, 12);
}

async function previousFromCampaign(workspaceId: string, campaignId: string | null): Promise<string[]> {
  if (!campaignId) return [];
  const posts = await db.socialPost.findMany({
    where: { workspaceId, campaignId, status: { in: ["posted", "partial", "scheduled"] } },
    orderBy: [{ publishedAt: "desc" }, { scheduledAt: "desc" }],
    take: 8,
    select: { text: true },
  });
  return posts.map((p) => p.text).filter(Boolean);
}

export async function generateBatchAction(formData: FormData) {
  const { workspace, user } = await requireRole("EDITOR");
  const scenario = String(formData.get("scenario") ?? "") as Scenario;
  if (!SCENARIOS[scenario]) studio({}, { err: "Pick a scenario." });
  const back = { s: scenario };
  const tz = await getPostingTimeZone(workspace.id);
  const minute = parsePostAt(String(formData.get("postAt") ?? "08:00"));
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 2000) || null;

  let input: ScenarioInput;
  let title: string;
  let campaignId: string | null = null;
  let plan: Array<Pick<BatchItem, "day" | "minute" | "mediaKey" | "specialDayId" | "past">> = [];

  const campaignFrom = async () => {
    const raw = String(formData.get("campaignId") ?? "").trim();
    const c = raw ? await db.campaign.findFirst({ where: { id: raw, workspaceId: workspace.id }, select: { id: true, name: true } }) : null;
    const name = c?.name ?? (String(formData.get("campaignName") ?? "").trim().slice(0, 120) || null);
    return { id: c?.id ?? null, name };
  };

  if (scenario === "special_days") {
    const month = String(formData.get("month") ?? "");
    const range = monthRange(month);
    if (!range) studio(back, { err: "Pick a month." });
    const days = await db.specialDay.findMany({
      where: { workspaceId: workspace.id, selected: true, day: { gte: range.from, lte: range.to } },
      orderBy: { day: "asc" },
    });
    if (days.length === 0) studio({ s: "special_days", month }, { err: `No days are ticked for ${range.label} — tick the ones the client picked first.` });
    input = { scenario, days: days.map((d) => ({ name: d.name, date: d.day, note: d.note })), notes };
    title = `Special days · ${range.label}`;
    // ⚠ A day whose posting time has gone is PAST, like a countdown stage —
    // it used to be marked live, saved as a timeless draft and queued by full
    // autonomy into the next free slot: a holiday post on a random day (SOC-05).
    plan = days.map((d) => {
      const at = dayAt(d.day, minute, tz);
      return { day: d.day, minute, mediaKey: null, specialDayId: d.id, past: !at || at.getTime() < Date.now() + 60_000 };
    });
  } else if (scenario === "campaign") {
    const c = await campaignFrom();
    if (!c.name) studio(back, { err: "Pick a campaign or give it a name." });
    campaignId = c.id;
    const count = Math.min(12, Math.max(1, parseInt(String(formData.get("count") ?? "4"), 10) || 4));
    const previous = [...(await previousFromCampaign(workspace.id, c.id)), ...splitPasted(String(formData.get("previous") ?? ""))].slice(0, 12);
    input = { scenario, campaign: c.name, count, previous, notes };
    title = `${c.name} · ${count} new post${count === 1 ? "" : "s"}`;
    plan = Array.from({ length: count }, () => ({ day: null, minute, mediaKey: null, specialDayId: null }));
  } else if (scenario === "images") {
    const c = await campaignFrom();
    if (!c.name) studio(back, { err: "Pick a campaign or give it a name." });
    campaignId = c.id;
    const images: Array<{ description: string; key: string | null }> = [];
    try {
      for (let i = 0; i < 10; i++) {
        const description = String(formData.get(`desc_${i}`) ?? "").trim().slice(0, 600);
        const key = await storeImage(formData.get(`img_${i}`), workspace.id);
        if (description) images.push({ description, key });
        else if (key) studio(back, { err: `Image ${i + 1} has no description — the description is what the caption is written from.` });
      }
    } catch (e) {
      studio(back, { err: e instanceof Error ? e.message : "Couldn't store an image." });
    }
    // Picked from the media library: its description is the input.
    const libIds = formData.getAll("lib").map(String).filter(Boolean).slice(0, 10);
    if (libIds.length) {
      const lib = await db.mediaItem.findMany({ where: { id: { in: libIds }, workspaceId: workspace.id } });
      const bare = lib.filter((m) => !m.description?.trim());
      if (bare.length) studio(back, { err: `${bare.map((m) => m.name).join(", ")} ${bare.length === 1 ? "has" : "have"} no description in the library — add one there first; it's what the caption is written from.` });
      for (const m of lib) images.push({ description: m.description!.trim().slice(0, 600), key: m.key });
    }
    if (images.length === 0) studio(back, { err: "Add at least one image description." });
    const previous = [...(await previousFromCampaign(workspace.id, c.id)), ...splitPasted(String(formData.get("previous") ?? ""))].slice(0, 12);
    input = { scenario, campaign: c.name, images: images.map((im) => ({ description: im.description })), previous, notes };
    title = `${c.name} · ${images.length} image${images.length === 1 ? "" : "s"}`;
    plan = images.map((im) => ({ day: null, minute, mediaKey: im.key, specialDayId: null }));
  } else {
    const event = String(formData.get("event") ?? "").trim().slice(0, 3000);
    const eventDay = String(formData.get("eventDay") ?? "").trim();
    const eventName = String(formData.get("eventName") ?? "").trim().slice(0, 120);
    const stages = formData.getAll("stages").map(String).filter((s): s is StageKey => COUNTDOWN_STAGES.some((c) => c.key === s));
    if (!eventName || !event) studio(back, { err: "Give the event a name and its details (date, time, place, how to register)." });
    if (!isValidDay(eventDay)) studio(back, { err: "Give the event's date." });
    if (stages.length === 0) studio(back, { err: "Tick at least one countdown post." });
    const days = countdownDays(eventDay, stages, tz);
    input = { scenario, event: `${eventName}\n${event}\nEvent date: ${eventDay}`, stages: days.map((d) => d.label), notes };
    title = `${eventName} · countdown`;
    plan = days.map((d) => ({ day: d.day, minute, mediaKey: null, specialDayId: null, past: d.past }));
  }

  const res = await generateCaptions(workspace.id, input, user.id);
  if (!res.ok) studio(back, { err: res.error });
  const items: BatchItem[] = res.items.map((it, i) => ({
    ...it,
    flags: res.flags[i] ?? [],
    day: plan[i]?.day ?? null,
    minute: plan[i]?.minute ?? minute,
    include: !plan[i]?.past,
    mediaKey: plan[i]?.mediaKey ?? null,
    specialDayId: plan[i]?.specialDayId ?? null,
    postId: null,
    past: plan[i]?.past ?? false,
  }));
  const batch = await db.captionBatch.create({
    data: {
      workspaceId: workspace.id,
      scenario,
      title,
      campaignId,
      input: writeJson({ ...input, minute }),
      items: writeJson(items),
      provider: res.provider,
      createdById: user.id,
    },
  });
  revalidatePath("/social/captions");
  redirect(`/social/captions/${batch.id}`);
}

export async function regenerateBatchAction(formData: FormData) {
  const { workspace, user } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  const old = await db.captionBatch.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!old) studio({}, { err: "That batch isn't in this workspace." });
  const stored = readJson<ScenarioInput & { minute?: number }>(old.input, null as never);
  const oldItems = readJson<BatchItem[]>(old.items, []);
  const res = await generateCaptions(workspace.id, stored, user.id);
  if (!res.ok) redirect(`/social/captions/${old.id}?err=${encodeURIComponent(res.error)}`);
  // Same items, same days, same images — fresh words.
  const items: BatchItem[] = res.items.map((it, i) => ({
    ...it,
    flags: res.flags[i] ?? [],
    day: oldItems[i]?.day ?? null,
    minute: oldItems[i]?.minute ?? stored.minute ?? 480,
    include: oldItems[i]?.include ?? true,
    mediaKey: oldItems[i]?.mediaKey ?? null,
    specialDayId: oldItems[i]?.specialDayId ?? null,
    postId: null,
    past: oldItems[i]?.past ?? false,
  }));
  const batch = await db.captionBatch.create({
    data: { workspaceId: workspace.id, scenario: old.scenario, title: old.title, campaignId: old.campaignId, input: old.input, items: writeJson(items), provider: res.provider, createdById: user.id },
  });
  revalidatePath("/social/captions");
  redirect(`/social/captions/${batch.id}`);
}

// ── Review → posts ─────────────────────────────────────────────────────────

/**
 * Save the reviewed batch. `mode`:
 *   edits    — keep the edits, nothing else;
 *   schedule — each included caption at its own day and time;
 *   queue    — each into the next free posting slot (campaign / images);
 *   drafts   — drafts that KEEP their proposed time. ⚠ A draft with a time
 *              is never auto-queued: under full autonomy the sweep gives
 *              every UNSCHEDULED draft the next free slot, which would send
 *              a holiday post on a random day.
 */
export async function saveBatchAction(formData: FormData) {
  const { workspace, user, membership } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  const mode = String(formData.get("mode") ?? "edits");
  const batch = await db.captionBatch.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!batch) studio({}, { err: "That batch isn't in this workspace." });
  const here = (msg: { ok?: string; err?: string }): never =>
    redirect(`/social/captions/${batch.id}?${msg.ok ? `ok=${encodeURIComponent(msg.ok)}` : `err=${encodeURIComponent(msg.err ?? "")}`}`);

  // 1. Fold the edits in.
  const items = readJson<BatchItem[]>(batch.items, []);
  try {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.postId) continue; // already a post — edit it there
      const g = (k: string) => formData.get(`${k}_${i}`);
      if (g("h") != null) it.header = String(g("h")).trim().slice(0, 200);
      if (g("b") != null) it.body = String(g("b")).trim().slice(0, 2000);
      if (g("t") != null) it.hashtags = String(g("t")).split(/[\s,]+/).map((t) => t.trim()).filter(Boolean).map((t) => (t.startsWith("#") ? t : `#${t}`)).slice(0, 6);
      if (g("x") != null) it.x = String(g("x")).trim().slice(0, 400);
      if (g("d") != null) { const d = String(g("d")).trim(); it.day = isValidDay(d) ? d : null; }
      if (g("tm") != null) it.minute = parsePostAt(String(g("tm")));
      it.include = String(g("inc") ?? "") === "on";
      const key = await storeImage(g("m"), workspace.id);
      if (key) it.mediaKey = key;
      if (String(g("rm") ?? "") === "on") it.mediaKey = null;
    }
  } catch (e) {
    here({ err: e instanceof Error ? e.message : "Couldn't store an image." });
  }
  const stored = readJson<ScenarioInput>(batch.input, null as never);
  const previous = stored && (stored.scenario === "campaign" || stored.scenario === "images") ? stored.previous : [];
  const flags = checkBatch(items, previous);
  items.forEach((it, i) => { it.flags = flags[i]; });
  await db.captionBatch.update({ where: { id: batch.id }, data: { items: writeJson(items) } });
  if (mode === "edits") here({ ok: "Saved your edits." });

  // 2. Make posts from the included captions.
  const accountIds = formData.getAll("accountIds").map(String).filter(Boolean);
  const accounts = accountIds.length
    ? await db.zernioAccount.findMany({ where: { id: { in: accountIds }, workspaceId: workspace.id, status: "connected" } })
    : [];
  if (mode !== "drafts" && accounts.length === 0) here({ err: "Tick at least one account to post to — or save them as drafts." });
  let category = String(formData.get("category") ?? "").trim().slice(0, 40) || null;
  if (category === "__new__") category = await addCategory(workspace.id, String(formData.get("categoryNew") ?? ""));
  const { getSetting } = await import("@/lib/settings");
  const requireApproval = (await getSetting("social:require_approval", workspace.id).catch(() => "")) === "true";
  const held = requireApproval && membership.role !== "ADMIN";
  const tz = await getPostingTimeZone(workspace.id);

  let made = 0;
  const notes: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.include || it.postId) continue;
    const label = it.item.replace(/\s*\(\d{4}-\d{2}-\d{2}\)$/, "");
    let scheduledAt: Date | null = null;
    let status = "draft";
    // The day's own time is chosen; a queue slot isn't (SOC-17).
    let timeChosen = false;
    const at = it.day ? dayAt(it.day, it.minute, tz) : null;
    // A caption written for a day (a special day, or a countdown stage) only
    // ever goes out on that day: never saved without its time, never put in
    // a slot. Once the day has passed it's skipped, whatever the mode.
    const dated = it.specialDayId != null || batch.scenario === "special_days" || batch.scenario === "countdown";
    if (dated && (!at || at.getTime() < Date.now() + 60_000)) { notes.push(`${label}: ${at ? "its day has passed" : "no date"}`); continue; }
    if (mode === "schedule" || (dated && mode === "queue")) {
      if (!at) { notes.push(`${label}: no date`); continue; }
      if (at.getTime() < Date.now() + 60_000) { notes.push(`${label}: its time has passed`); continue; }
      scheduledAt = at;
      timeChosen = true;
      status = "scheduled";
    } else if (mode === "queue") {
      const claim = await claimNextFreeSlot(workspace.id, undefined, category);
      if ("error" in claim) { notes.push(`${label}: ${queueFailureMessage(claim.error)}`); break; }
      scheduledAt = claim.at;
      status = "scheduled";
    } else {
      // Drafts keep their proposed time when they have one (see above).
      scheduledAt = at && at.getTime() > Date.now() ? at : null;
      timeChosen = scheduledAt != null;
    }
    if (held) status = "draft";

    const media = it.mediaKey ? [it.mediaKey] : [];
    const targets: Array<{ provider: string; accountId: string; accountName: string | null; text: string | null }> = [];
    for (const a of accounts) {
      const net = networkFor(a.platform);
      if (net?.requiresMedia && media.length === 0) { notes.push(`${label}: ${net.label} left off — it needs an image`); continue; }
      if (a.platform.toLowerCase() === "twitter") {
        if (!it.x || it.x.length > X_LIMIT) { notes.push(`${label}: X left off — no version under ${X_LIMIT} characters`); continue; }
        targets.push({ provider: a.platform, accountId: a.accountId, accountName: a.displayName ?? a.username, text: it.x });
        continue;
      }
      targets.push({ provider: a.platform, accountId: a.accountId, accountName: a.displayName ?? a.username, text: null });
    }
    if (targets.length === 0 && mode !== "drafts") { notes.push(`${label}: nowhere left to post it`); continue; }

    const post = await db.socialPost.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        source: "captions",
        campaignId: batch.campaignId,
        category,
        text: assemble(it),
        mediaKeys: writeJson(media),
        scheduledAt,
        timeChosen,
        status,
        approval: requireApproval ? (held ? "pending" : "approved") : null,
        targets: { create: targets },
      },
    });
    it.postId = post.id;
    made++;
    if (media.length === 0 && !held) {
      // Same default-to-image rule as Compose; the job honours the
      // workspace's auto-image switch and never stores a mock image.
      const { jobs } = await import("@/lib/jobs");
      await jobs.enqueue("social.autoimage", { postId: post.id }, { refId: post.id, workspaceId: workspace.id });
    }
  }
  const allDone = items.filter((it) => it.include).every((it) => it.postId);
  await db.captionBatch.update({ where: { id: batch.id }, data: { items: writeJson(items), ...(allDone ? { status: "saved", savedAt: new Date() } : {}) } });
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "captions.saved", entityType: "caption_batch", entityId: batch.id, meta: { mode, made, skipped: notes.length, held } });
  if (held && made) {
    const { notify } = await import("@/lib/notify");
    await notify({ workspaceId: workspace.id, kind: "approval_needed", title: `${made} caption${made === 1 ? "" : "s"} waiting for approval`, body: batch.title, path: "/social/approvals", entityType: "caption_batch", entityId: batch.id, excludeUserId: user.id });
  }
  revalidatePath("/social", "layout");
  const summary = `${made} post${made === 1 ? "" : "s"} ${held ? "sent for approval (they keep their times)" : mode === "drafts" ? "saved as drafts" : mode === "queue" ? "queued" : "scheduled"}.${notes.length ? ` Skipped or trimmed — ${notes.slice(0, 6).join("; ")}${notes.length > 6 ? "; …" : ""}.` : ""}`;
  if (made === 0) here({ err: summary });
  redirect(`/social/${held || mode === "drafts" ? "drafts" : "queue"}?ok=${encodeURIComponent(summary)}`);
}
