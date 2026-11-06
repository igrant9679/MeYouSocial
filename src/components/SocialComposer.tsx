"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Send, CalendarClock, ImagePlus, X, Pencil, RotateCcw, Tags, Plus, ListPlus, Megaphone, Recycle, Sparkles, Loader2, Eye, EyeOff, Wand2, Check } from "lucide-react";
import { SubmitButton } from "@/components/SubmitButton";
import { createSocialPostAction, updateSocialPostAction } from "@/app/actions/social";
import { generateComposerImageAction } from "@/app/actions/social-image-gen";
import { tailorPostForNetworksAction } from "@/app/actions/social-tailor";
import { saveMyDefaultAccountsAction } from "@/app/actions/social-defaults";
import { networkFor } from "@/lib/social/networks";
import { subFormatsFor, AUTOMATIC_SUB_FORMAT } from "@/lib/social/sub-formats";
import { FIRST_COMMENT_NETWORKS, TIKTOK_COMMERCIAL, TIKTOK_DEFAULTS, TIKTOK_PRIVACY, splitLinks, supportsFirstComment, type TikTokOptions } from "@/lib/social/platform-options";
import { applyUtm, type UtmConfig } from "@/lib/social/utm-apply";
import { lengthNote, postLength } from "@/lib/social/text-length";
import { WATERMARK_POSITIONS } from "@/lib/social/watermark-options";
import { HelpTip, WithTip } from "@/components/HelpTip";
import { SOCIAL_TIPS } from "@/lib/help-tips";
import { AiAssist } from "@/components/AiAssist";

/** A composer-generated AI image, already stored server-side. */
type GenImage = { key: string; url: string; provider: string; video?: boolean };
/** What a preview shows for one attachment. */
type PreviewMedia = { url: string; video: boolean };

const IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp";
const MEDIA_ACCEPT = `${IMAGE_ACCEPT},video/mp4,video/quicktime,video/webm`;
/** A post's files travel in one request, capped at 64 MB on the server
 *  (next.config); VIDEO_BYTES in lib/media-probe, which can't load here. */
const UPLOAD_LIMIT = 60 * 1024 * 1024;
const isVideoFile = (f?: File) => !!f?.type.startsWith("video/");

/**
 * An attached file as a picture of itself (tracker #14: a bare file name was
 * confusing), with its name underneath and a remove button. `url` is the
 * object URL the previews already use.
 */
function FileThumb({ file, url, onRemove }: { file: File; url: string | undefined; onRemove: () => void }) {
  return (
    <span className="relative inline-flex flex-col items-center gap-0.5 w-20" data-attached-file title={file.name}>
      {url && isVideoFile(file) ? (
        <video src={url} muted preload="metadata" className="h-20 w-20 rounded-lg object-cover border border-[var(--line)] bg-black" />
      ) : url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={file.name} className="h-20 w-20 rounded-lg object-cover border border-[var(--line)]" />
      ) : (
        <span className="h-20 w-20 rounded-lg border border-[var(--line)] grid place-items-center text-[10px] text-[var(--mute)]">file</span>
      )}
      <span className="font-mono text-[9px] text-[var(--mute)] truncate w-full text-center">{file.name}</span>
      <button type="button" aria-label={`Remove ${file.name}`} onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 rounded-full p-0.5 border border-[var(--line-2)]" style={{ background: "var(--panel)" }}>
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

/** "2 images, 1 video". Pure. */
function mediaWords(items: PreviewMedia[]): string {
  const v = items.filter((m) => m.video).length;
  const i = items.length - v;
  return [i ? `${i} image${i > 1 ? "s" : ""}` : "", v ? `${v} video${v > 1 ? "s" : ""}` : ""].filter(Boolean).join(", ");
}

export type ComposerAccount = { id: string; provider: string; name: string | null };
export type ComposerTopic = { id: string; name: string; keywords: string[] };
export type ComposerCampaign = { id: string; name: string; color: string | null; utmCampaign?: string | null };

/** An existing post being edited. Absent = composing a new one. */
export type ComposerInitial = {
  id: string;
  text: string;
  topicId: string | null;
  campaignId: string | null;
  category: string | null;
  evergreen: boolean;
  recycleEveryDays: number;
  /** The scheduled time as a `datetime-local` value in the workspace's POSTING
   *  timezone — the zone the action reads it back in (SOC-03). Converting in the
   *  browser shifted it by the viewer's offset on every save. */
  scheduledAtLocal: string | null;
  accountIds: string[];
  /** Per-provider text overrides already saved on the post. */
  variants: Record<string, string>;
  /** Per-provider "publish as" already saved, keyed by UPPERCASED slug. */
  subFormats?: Record<string, string>;
  /** How many images the post already has (per base / per provider). */
  existingMedia: number;
  firstComment?: string | null;
  linkToFirstComment?: boolean;
  watermark?: string | null;
  /** Per-provider first comments, keyed by UPPERCASED slug. */
  firstComments?: Record<string, string>;
  /** UPPERCASED slugs whose target has its own images. */
  ownMedia?: string[];
  tiktok?: TikTokOptions | null;
};

/** The measured best time for "Optimal", or why there isn't one (social/optimal.ts). */
export type ComposerOptimal = { label: string; why: string } | { reason: string };

/**
 * Unicode bold / italic (Mathematical Sans-Serif) — what Socialmonials' B and I
 * buttons do, since no network takes markup. Letters and digits only; anything
 * else passes through. Screen readers may spell styled letters out, so the
 * buttons say "sparingly".
 */
export function styleText(s: string, kind: "bold" | "italic"): string {
  const A = kind === "bold" ? 0x1d5d4 : 0x1d608; // 𝗔 / 𝘈
  const a = kind === "bold" ? 0x1d5ee : 0x1d622; // 𝗮 / 𝘢
  const zero = kind === "bold" ? 0x1d7ec : null; // 𝟬 (no italic digits exist)
  return Array.from(s).map((ch) => {
    const c = ch.codePointAt(0)!;
    if (c >= 65 && c <= 90) return String.fromCodePoint(A + c - 65);
    if (c >= 97 && c <= 122) return String.fromCodePoint(a + c - 97);
    if (zero && c >= 48 && c <= 57) return String.fromCodePoint(zero + c - 48);
    return ch;
  }).join("");
}

/** State of the workspace's posting schedule, for the "Add to queue" option. */
export type ComposerQueue = {
  /** The next free slot, already formatted in the workspace's posting zone. */
  nextFree: string | null;
  /** Whether a schedule exists at all — distinguishes "no slots" from "all full". */
  hasSlots: boolean;
  /** The posting timezone a typed date-time is read in, shown beside the field. */
  timeZone?: string;
};

// Buffer/Hootsuite-style composer: pick accounts, write a base post once, then
// optionally customize text AND images per network. Each network shows its own
// live character count against its own limit.

/** Rewrite a file input's FileList so removing a chip actually drops the upload. */
function syncInput(input: HTMLInputElement | null, files: File[]) {
  if (!input) return;
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  input.files = dt.files;
}

export function SocialComposer({
  accounts,
  topics = [],
  campaigns = [],
  categories = [],
  approvalNotice = false,
  initial,
  queue,
  watermarkAvailable = false,
  optimal,
  preloadMedia = [],
  snippets = [],
  seed,
  utm,
  defaultAccountIds = [],
}: {
  accounts: ComposerAccount[];
  topics?: ComposerTopic[];
  /** Active campaigns this post can join. */
  campaigns?: ComposerCampaign[];
  /** The workspace's post categories (social/categories.ts), slot lanes included. */
  categories?: string[];
  /** True when this user's posts are held for approval before sending. */
  approvalNotice?: boolean;
  initial?: ComposerInitial;
  queue?: ComposerQueue;
  /** A usable logo is on file, so the watermark can be offered. */
  watermarkAvailable?: boolean;
  optimal?: ComposerOptimal;
  /** Library images picked on Distribute → Media, attached as base media. */
  preloadMedia?: Array<{ key: string; url: string; video?: boolean }>;
  /** Saved hashtag sets and snippets (E-SOC-10); a category narrows where one is offered. */
  snippets?: Array<{ id: string; name: string; body: string; category: string | null }>;
  /** A template's content to start a NEW post from (E-SOC-23) — unlike `initial`, this isn't editing. */
  seed?: { text: string; firstComment: string | null; category: string | null };
  /** The workspace's link tagging (E-SOC-09): previews show links as the send will tag them. */
  utm?: UtmConfig;
  /** This person's saved starting selection (tracker #32), already narrowed to connected accounts. */
  defaultAccountIds?: string[];
}) {
  // Editing reuses this component wholesale rather than a parallel form — a
  // second implementation would drift from the composer's per-network rules.
  const editing = Boolean(initial);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initial ? initial.accountIds : defaultAccountIds.length ? defaultAccountIds : accounts.length === 1 ? [accounts[0].id] : []),
  );
  // "Make this my default": saved without leaving the page, so the post being written survives.
  const [defaultNote, setDefaultNote] = useState<string | null>(null);
  const [savingDefault, setSavingDefault] = useState(false);
  const saveDefault = async () => {
    setSavingDefault(true);
    setDefaultNote(null);
    try {
      const r = await saveMyDefaultAccountsAction([...selected]);
      setDefaultNote(r.message);
    } catch {
      setDefaultNote("Couldn't save the default — try again.");
    } finally {
      setSavingDefault(false);
    }
  };
  const [text, setText] = useState(initial?.text ?? seed?.text ?? "");
  const [topicId, setTopicId] = useState(initial?.topicId ?? "");
  const [campaignId, setCampaignId] = useState(initial?.campaignId ?? "");
  const [evergreen, setEvergreen] = useState(initial?.evergreen ?? false);
  const [variants, setVariants] = useState<Record<string, string>>(initial?.variants ?? {});
  // A network with its own first comment or images opens customized too: its
  // fields live in that section, and a field that isn't rendered isn't
  // submitted — the edit used to wipe them (SOC-18).
  const [customizing, setCustomizing] = useState<Set<string>>(
    new Set([...Object.keys(initial?.variants ?? {}), ...Object.keys(initial?.firstComments ?? {}), ...(initial?.ownMedia ?? [])]),
  );
  const [when, setWhen] = useState<"now" | "schedule" | "draft" | "queue" | "optimal">(
    initial ? (initial.scheduledAtLocal ? "schedule" : "draft") : accounts.length === 0 ? "draft" : "now",
  );
  const [category, setCategory] = useState(initial?.category ?? seed?.category ?? "");
  const [firstComment, setFirstComment] = useState(initial?.firstComment ?? seed?.firstComment ?? "");
  // Controlled so the previews follow them (E-SOC-09): moving links to the first
  // comment, each network's own first comment, and Story / Reel / feed.
  const [linkToComment, setLinkToComment] = useState(initial?.linkToFirstComment ?? false);
  const [ownComments, setOwnComments] = useState<Record<string, string>>(initial?.firstComments ?? {});
  const [subFormats, setSubFormats] = useState<Record<string, string>>(initial?.subFormats ?? {});
  const [tiktok, setTiktok] = useState<TikTokOptions>(initial?.tiktok ?? TIKTOK_DEFAULTS);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const optimalPick = optimal && "label" in optimal ? optimal : null;
  const [clearMedia, setClearMedia] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [variantFiles, setVariantFiles] = useState<Record<string, File[]>>({});
  // AI-generated base images: stored server-side the moment they're generated,
  // attached to the post only on submit (hidden generatedKeys inputs).
  // Library images arrive like AI images: already stored, attached on submit
  // through the same hidden generatedKeys inputs (and the same server check).
  const [genImages, setGenImages] = useState<GenImage[]>(preloadMedia.slice(0, 4).map((m) => ({ key: m.key, url: m.url, provider: "library", video: m.video })));
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genGuidance, setGenGuidance] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  // AI per-network tailoring: PROPOSED variants awaiting accept/discard.
  const [tailorBusy, setTailorBusy] = useState(false);
  const [tailorError, setTailorError] = useState<string | null>(null);
  const [proposed, setProposed] = useState<Record<string, string>>({});
  const [tailorNote, setTailorNote] = useState<string | null>(null);

  const baseInput = useRef<HTMLInputElement>(null);
  const variantInputs = useRef<Record<string, HTMLInputElement | null>>({});

  // Object URLs for uploaded files, for the preview frames. Revoked on change.
  const fileUrls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  const variantFileUrls = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const [p, fs] of Object.entries(variantFiles)) out[p] = fs.map((f) => URL.createObjectURL(f));
    return out;
  }, [variantFiles]);
  useEffect(() => () => { fileUrls.forEach((u) => URL.revokeObjectURL(u)); }, [fileUrls]);
  useEffect(() => () => { Object.values(variantFileUrls).flat().forEach((u) => URL.revokeObjectURL(u)); }, [variantFileUrls]);

  // Distinct providers among the selected accounts — one customization row each.
  const selectedProviders = useMemo(() => {
    const set = new Set<string>();
    for (const a of accounts) if (selected.has(a.id)) set.add(a.provider.toUpperCase());
    return [...set];
  }, [accounts, selected]);

  // What a network will actually post — its override when customizing and
  // non-empty, else the base. Mirrors the server's fallback exactly. AI images
  // are BASE media (they attach to the post, not a variant).
  const effectiveText = (p: string) =>
    customizing.has(p) && (variants[p] ?? "").trim() ? variants[p] : text;
  const effectiveMediaCount = (p: string) =>
    customizing.has(p) && (variantFiles[p]?.length ?? 0) > 0
      ? variantFiles[p].length
      : files.length + genImages.length;
  /** What a network's preview should show, mirroring effectiveMediaCount. */
  const previewImagesFor = (p: string): PreviewMedia[] =>
    customizing.has(p) && (variantFiles[p]?.length ?? 0) > 0
      ? (variantFileUrls[p] ?? []).map((url, i) => ({ url, video: isVideoFile(variantFiles[p][i]) }))
      : [...fileUrls.map((url, i) => ({ url, video: isVideoFile(files[i]) })), ...genImages.map((g) => ({ url: g.url, video: !!g.video }))];
  // Said before the upload starts: over the server's cap the whole save fails.
  const uploadBytes = [...files, ...[...customizing].flatMap((p) => variantFiles[p] ?? [])].reduce((n, f) => n + f.size, 0);
  const tooBig = uploadBytes > UPLOAD_LIMIT;

  /** Accept one proposed variant: turn on that network's override and fill it. */
  function acceptProposal(providerUpper: string) {
    const key = providerUpper.toLowerCase();
    const text = proposed[key];
    if (!text) return;
    setCustomizing((prev) => new Set(prev).add(providerUpper));
    setVariants((v) => ({ ...v, [providerUpper]: text }));
    setProposed((p) => { const c = { ...p }; delete c[key]; return c; });
  }

  async function tailorForNetworks() {
    setTailorBusy(true);
    setTailorError(null);
    setTailorNote(null);
    try {
      const providers = accounts.filter((a) => selected.has(a.id)).map((a) => a.provider.toLowerCase());
      const res = await tailorPostForNetworksAction({ text, providers, guidance: genGuidance || undefined });
      if (!res.ok) {
        setTailorError(res.error);
        return;
      }
      setProposed(res.variants);
      const notes: string[] = [];
      if (Object.keys(res.variants).length === 0) {
        notes.push("Nothing needed rewriting — the base post already suits every selected network.");
      }
      if (res.skipped.length) {
        notes.push(`Left on the base text: ${res.skipped.map((p) => networkFor(p)?.label ?? p).join(", ")}.`);
      }
      if (res.stillOver.length) {
        notes.push(`⚠ Still over the limit after rewriting: ${res.stillOver.map((p) => networkFor(p)?.label ?? p).join(", ")} — shorten by hand.`);
      }
      setTailorNote(notes.join(" ") || null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setTailorError(
        /server action|older or newer deployment/i.test(msg)
          ? "This page is out of date after an update — reload it, then try again."
          : "Couldn't reach the model. Try again.",
      );
    } finally {
      setTailorBusy(false);
    }
  }

  async function generateAiImage() {
    setGenBusy(true);
    setGenError(null);
    try {
      const squareFirst = new Set(["instagram", "pinterest", "tiktok"]);
      const square = accounts.some((a) => selected.has(a.id) && squareFirst.has(a.provider.toLowerCase()));
      const res = await generateComposerImageAction({ text, guidance: genGuidance, square });
      if (res.ok) {
        setGenImages((g) => [...g, { key: res.key, url: res.url, provider: res.provider }].slice(0, 4));
      } else {
        setGenError(res.error);
      }
    } catch {
      setGenError("Image generation failed — try again.");
    } finally {
      setGenBusy(false);
    }
  }

  // What each network will be SENT (E-SOC-09), built the way lib/social/publish.ts
  // builds it: links tagged (the campaign's own tag first), then — where a first
  // comment exists — links moved out of the caption into it. Counting and the
  // previews read this, so a counter can't pass a post the send would refuse.
  const campaignUtm = campaigns.find((c) => c.id === campaignId)?.utmCampaign?.trim() ?? "";
  const utmCfg = utm ? (campaignUtm ? { ...utm, campaign: campaignUtm } : utm) : null;
  const tag = (t: string, p: string) => (utmCfg ? applyUtm(t, utmCfg, p) : t);
  const sendFor = (p: string): { text: string; comment: string | null } => {
    let out = tag(effectiveText(p), p);
    const takesComment = supportsFirstComment(p, subFormats[p] || null);
    const own = ((customizing.has(p) ? ownComments[p] : "") || firstComment).trim();
    let comment = takesComment && own ? tag(own, p) : null;
    if (linkToComment && takesComment) {
      const { caption, links } = splitLinks(out);
      if (links.length && caption) {
        out = caption;
        comment = [links.join("\n"), comment].filter(Boolean).join("\n\n");
      }
    }
    return { text: out, comment };
  };
  const anyOver = selectedProviders.some((p) => postLength(p, sendFor(p).text) > (networkFor(p)?.charLimit ?? 3000));
  // Over-limit blocks SENDING (the network would refuse) but never PARKING:
  // "save as draft and trim later" is the whole point of drafts. Editing an
  // existing post with when="draft" is the same parking action.
  const overBlocks = anyOver && when !== "draft";
  // TikTok has no default audience by its own rules — a send without one is
  // refused here AND on the server (platform-options.tiktokRefusal).
  const tiktokSelected = selectedProviders.includes("TIKTOK");
  const tiktokBlocks = tiktokSelected && when !== "draft" && !tiktok.privacy;
  const brandedSelfOnly = tiktokSelected && tiktok.commercial === "brand_content" && tiktok.privacy === "SELF_ONLY";
  const firstCommentProviders = selectedProviders.filter((p) => FIRST_COMMENT_NETWORKS.has(p.toLowerCase()));
  const topic = topics.find((t) => t.id === topicId);

  /** B / I on the base text: style the selection, or the whole text when nothing is selected. */
  function applyStyle(kind: "bold" | "italic") {
    const el = textRef.current;
    const start = el?.selectionStart ?? 0;
    const end = el?.selectionEnd ?? 0;
    if (start === end) {
      setText((t) => styleText(t, kind));
      return;
    }
    setText((t) => t.slice(0, start) + styleText(t.slice(start, end), kind) + t.slice(end));
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const toggleCustom = (provider: string) =>
    setCustomizing((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) {
        next.delete(provider);
        setVariants((v) => { const c = { ...v }; delete c[provider]; return c; });
        setVariantFiles((v) => { const c = { ...v }; delete c[provider]; return c; });
        syncInput(variantInputs.current[provider], []);
      } else {
        next.add(provider);
        setVariants((v) => ({ ...v, [provider]: text })); // seed from base
      }
      return next;
    });

  // No accounts connected: the composer still works, in DRAFT-ONLY mode — the
  // CSV import and autogen already create account-less drafts, and the page's
  // own banner promises "you can still write and save drafts" (it used to lie:
  // this early-returned a dead card, caught in the 2026-08-25 walkthrough).
  // Send/schedule/queue need somewhere to send, so only Save-as-draft is
  // offered until an account exists.
  const noAccounts = accounts.length === 0;

  return (
    <form data-elsie="social-composer" action={editing ? updateSocialPostAction : createSocialPostAction} className="card mb-6 flex flex-col gap-3" encType="multipart/form-data"
      onSubmit={(e) => { if (tooBig) e.preventDefault(); }}>
      {editing && <input type="hidden" name="id" value={initial!.id} />}
      {/* Tells the save which networks are customized, so "Use base" can clear a
          network's own image (SOC-18). Older tabs without it keep the old rule. */}
      {editing && <input type="hidden" name="perNetworkMarks" value="1" />}
      {/* Account picker */}
      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] mb-1.5 flex items-center gap-1.5">
          Post to <HelpTip text={SOCIAL_TIPS.postTo} side="bottom" wide />
          {accounts.length > 1 && (
            <span className="normal-case tracking-normal inline-flex items-center gap-2 ml-2">
              <button type="button" className="underline" onClick={() => setSelected(new Set(accounts.map((a) => a.id)))}>Select all</button>
              <button type="button" className="underline" onClick={() => setSelected(new Set())}>Clear all</button>
            </span>
          )}
          {accounts.length > 1 && !editing && (
            <button type="button" className="normal-case tracking-normal underline ml-2 disabled:opacity-50" onClick={() => void saveDefault()} disabled={savingDefault}
              title="New posts you write here start with these accounts ticked — just for you" data-save-default>
              {savingDefault ? "Saving…" : selected.size ? "Make this my default" : "Clear my default"}
            </button>
          )}
          {defaultNote && <span className="normal-case tracking-normal ml-2" style={{ color: "var(--green-on)" }} role="status">{defaultNote}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {accounts.map((a) => {
            const net = networkFor(a.provider);
            const on = selected.has(a.id);
            return (
              <label key={a.id} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border cursor-pointer text-xs font-semibold transition-colors"
                style={on ? { borderColor: net?.color ?? "var(--accent)", background: "var(--accent-soft)", color: "var(--accent-on)" } : { borderColor: "var(--line-2)" }}>
                <input type="checkbox" name="accountIds" value={a.id} checked={on} onChange={() => toggle(a.id)} className="sr-only" />
                <span className="w-2 h-2 rounded-full" style={{ background: net?.color ?? "var(--mute)" }} />
                {net?.label ?? a.provider}
                <span className="text-[var(--mute)] font-normal truncate max-w-[140px]">{a.name}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Topic — optional, ties the post to a workspace theme */}
      {topics.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs">
            <Tags className="w-3.5 h-3.5" style={{ color: "var(--violet-on)" }} />
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Topic</span>
            <select name="topicId" value={topicId} onChange={(e) => setTopicId(e.target.value)}
              className="border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs">
              <option value="">— none —</option>
              {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          {/* Outside the <label> on purpose — a button inside one retargets the
              click to the select it labels. */}
          <HelpTip text={SOCIAL_TIPS.topic} side="bottom" wide />
          {/* That topic's related phrases, click to insert */}
          {topic?.keywords.map((k) => (
            <button key={k} type="button" title="Insert into the post"
              onClick={() => setText((prev) => (prev ? `${prev.replace(/\s+$/, "")} ${k}` : k))}
              className="inline-flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded-full border border-[var(--line-2)] hover:border-[var(--accent)]">
              <Plus className="w-2.5 h-2.5" /> {k}
            </button>
          ))}
        </div>
      )}

      {/* Campaign + category — both optional, both plain selects. */}
      {(
        <div className="flex flex-wrap items-center gap-3">
          {campaigns.length > 0 && (
            <>
              <label className="inline-flex items-center gap-1.5 text-xs">
                <Megaphone className="w-3.5 h-3.5" style={{ color: "var(--blue-on)" }} />
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Campaign</span>
                <select name="campaignId" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}
                  className="border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs">
                  <option value="">— none —</option>
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              {/* Sibling of the label, same trap as the Topic tip. */}
              <HelpTip text={SOCIAL_TIPS.campaign} side="bottom" wide />
            </>
          )}
          {/* Category — Socialmonials' label for filing and filtering posts;
              it still steers the queue (a slot of the same category first). */}
          <label className="inline-flex items-center gap-1.5 text-xs">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Category</span>
            <select name="category" value={category} onChange={(e) => setCategory(e.target.value)}
              className="border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs">
              <option value="">— none —</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              <option value="__new__">＋ Add category…</option>
            </select>
          </label>
          {category === "__new__" && (
            <input name="categoryNew" maxLength={40} autoFocus placeholder="New category name"
              className="border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs w-44" />
          )}
          <HelpTip text={SOCIAL_TIPS.slotCategory} side="bottom" wide />
          {/* Watermark — the workspace logo on images, at send. */}
          <label className="inline-flex items-center gap-1.5 text-xs" title={watermarkAvailable ? "Composited onto images when the post goes out; the stored original stays clean" : "Add a logo (Settings → Workspace) to watermark images"}>
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Watermark</span>
            <select name="watermark" defaultValue={watermarkAvailable ? (initial?.watermark ?? "") : ""} disabled={!watermarkAvailable}
              className="border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs">
              <option value="">None</option>
              {WATERMARK_POSITIONS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
            </select>
          </label>
          {!watermarkAvailable && <span className="text-[10px] text-[var(--mute)]">no logo on file</span>}
        </div>
      )}

      {/* Evergreen — flag it now; recycling starts once it has been posted. */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
          <input type="checkbox" name="evergreen" checked={evergreen} onChange={(e) => setEvergreen(e.target.checked)} />
          <Recycle className="w-3.5 h-3.5" style={{ color: "var(--green-on)" }} />
          Evergreen — recycle this post
        </label>
        <HelpTip text={SOCIAL_TIPS.evergreen} side="bottom" wide />
        {evergreen && (
          <label className="inline-flex items-center gap-1.5 text-[11px] text-[var(--mute)]">
            every
            <input type="number" name="recycleEveryDays" min={1} max={365}
              defaultValue={initial?.recycleEveryDays ?? 30}
              className="w-16 border border-[var(--line-2)] rounded-lg px-1.5 py-0.5 text-xs font-mono" />
            days, into a free queue slot
          </label>
        )}
      </div>

      {/* Base composer */}
      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] mb-1 flex items-center gap-2">
          {selectedProviders.length > 1 ? "Base post (used by any network you don’t customize)" : "Text"}
          <span className="flex-1" />
          {/* type="button" is load-bearing — these sit inside the form. */}
          <button type="button" className="btn sm !px-1.5 !py-0.5 font-bold normal-case" onClick={() => applyStyle("bold")} title="Bold the selection (or all the text). No network takes markup, so this uses styled Unicode letters — sparingly: screen readers may spell them out.">B</button>
          <button type="button" className="btn sm !px-1.5 !py-0.5 italic normal-case" onClick={() => applyStyle("italic")} title="Italicise the selection (or all the text), as styled Unicode letters — sparingly.">I</button>
        </div>
        <textarea
          ref={textRef}
          name="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="What do you want to share?"
          className="w-full border border-[var(--line-2)] rounded-lg p-2.5 text-sm resize-y"
        />
        {/* Saved snippets (E-SOC-10): one click puts the text where the cursor is
            (or at the end). Those for another category are left out. */}
        {snippets.some((s) => !s.category || s.category === category) && (
          <div className="flex flex-wrap items-center gap-1" data-snippets>
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Insert</span>
            {snippets.filter((s) => !s.category || s.category === category).map((s) => (
              <button key={s.id} type="button" title={s.body.slice(0, 200)}
                onClick={() => {
                  const el = textRef.current;
                  const at = el && document.activeElement === el ? el.selectionStart : null;
                  setText((prev) => (at == null ? (prev ? `${prev.replace(/\s+$/, "")}${/\n/.test(s.body) ? "\n\n" : " "}${s.body}` : s.body) : prev.slice(0, at) + s.body + prev.slice(at)));
                }}
                className="inline-flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded-full border border-[var(--line-2)] hover:border-[var(--accent)]">
                <Plus className="w-2.5 h-2.5" /> {s.name}
              </button>
            ))}
          </div>
        )}
        {/* This textarea is CONTROLLED, so accepting a draft has to go through
            the prototype value setter — see the note in AiAssist.accept(). */}
        <AiAssist field="social.post" target="text" label="Draft this post" />
        {/* Base media */}
        <div className="flex items-center gap-2 flex-wrap mt-2">
          <label className="btn sm cursor-pointer">
            <ImagePlus className="w-4 h-4" /> Add image or video
            <input ref={baseInput} type="file" name="media" accept={MEDIA_ACCEPT} multiple className="sr-only"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 4))} />
          </label>
          {/* AI image — generated from the post text, PROPOSED as a removable
              chip; nothing attaches until the form is submitted. type="button"
              is load-bearing (inside the form), and it is a SIBLING of the
              label above, never nested. */}
          <button
            type="button"
            className="btn sm"
            disabled={genBusy || genImages.length >= 4}
            onClick={generateAiImage}
            title="Generate an image from the post text"
          >
            {genBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {genBusy ? "Generating…" : "AI image"}
          </button>
          <input
            value={genGuidance}
            onChange={(e) => setGenGuidance(e.target.value)}
            maxLength={300}
            placeholder="Optional style hint (e.g. flat illustration, brand colors)"
            className="border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs min-w-56 flex-1 max-w-md"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (!genBusy) void generateAiImage(); } }}
          />
        </div>
        {files.length > 0 && (
          <div className="flex items-start gap-2 flex-wrap mt-2">
            {files.map((f, i) => (
              <FileThumb key={i} file={f} url={fileUrls[i]}
                onRemove={() => { const next = files.filter((_, j) => j !== i); setFiles(next); syncInput(baseInput.current, next); }} />
            ))}
          </div>
        )}
        {genError && (
          <p className="text-[11px] mt-1" style={{ color: "var(--amber-on)" }}>{genError}</p>
        )}
        {genImages.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap mt-2">
            {genImages.map((g, i) => (
              <span key={g.key} className="relative inline-block">
                <input type="hidden" name="generatedKeys" value={g.key} />
                {g.video ? (
                  <video src={g.url} muted preload="metadata" className="h-20 w-20 rounded-lg object-cover border border-[var(--line)] bg-black" data-attached-video="" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={g.url} alt={`AI image ${i + 1}`} className="h-20 w-20 rounded-lg object-cover border border-[var(--line)]" />
                )}
                <span className="absolute bottom-0.5 left-0.5 font-mono text-[9px] px-1 rounded" style={{ background: "var(--panel)", color: "var(--mute)" }}>
                  {g.provider}
                </span>
                <button
                  type="button"
                  aria-label={`Remove AI image ${i + 1}`}
                  onClick={() => setGenImages((prev) => prev.filter((x) => x.key !== g.key))}
                  className="absolute -top-1.5 -right-1.5 rounded-full p-0.5 border border-[var(--line-2)]"
                  style={{ background: "var(--panel)" }}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* First comment — only where Zernio documents one (Facebook, Instagram,
          LinkedIn, YouTube; never a Story). Each network can override it in
          its own row below. */}
      {firstCommentProviders.length > 0 && (
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] mb-1">
            First comment <span className="normal-case tracking-normal">— posted on {firstCommentProviders.map((p) => networkFor(p)?.label ?? p).join(", ")}{selectedProviders.length > firstCommentProviders.length ? "; the others have no first comment" : ""}</span>
          </div>
          <textarea name="firstComment" value={firstComment} onChange={(e) => setFirstComment(e.target.value)} rows={2} maxLength={2000}
            placeholder="Optional — e.g. the link, or a question to start the conversation"
            className="w-full border border-[var(--line-2)] rounded-lg p-2 text-sm resize-y" />
          <label className="inline-flex items-center gap-1.5 text-xs mt-1 cursor-pointer">
            <input type="checkbox" name="linkToFirstComment" checked={linkToComment} onChange={(e) => setLinkToComment(e.target.checked)} />
            Move links from the caption to the first comment
          </label>
          <span className="text-[10px] text-[var(--mute)] ml-2">LinkedIn and Instagram both hold back posts with a link in the caption. X and TikTok keep the link where it is.</span>
        </div>
      )}

      {/* TikTok — its own rules: no default audience, interaction switches,
          disclosures, and a declaration shown before sending (TikTok's
          content-posting guidelines; the fields are Zernio's tiktokSettings). */}
      {tiktokSelected && (
        <div className="rounded-lg border p-2.5" style={{ borderColor: "#010101" }}>
          <input type="hidden" name="tiktok_present_TIKTOK" value="1" />
          <div className="text-xs font-semibold mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ background: "#010101" }} /> TikTok
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="inline-flex items-center gap-1.5">
              Who can view this video
              <select name="tiktok_privacy_TIKTOK" value={tiktok.privacy ?? ""} onChange={(e) => setTiktok((t) => ({ ...t, privacy: (e.target.value || null) as TikTokOptions["privacy"] }))}
                className="border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs">
                <option value="">Select…</option>
                {TIKTOK_PRIVACY.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <span className="text-[var(--mute)]">Allow users to</span>
            {(["comment", "duet", "stitch"] as const).map((k) => {
              const key = k === "comment" ? "allowComment" : k === "duet" ? "allowDuet" : "allowStitch";
              return (
                <label key={k} className="inline-flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" name={`tiktok_${k}_TIKTOK`} checked={tiktok[key]} onChange={(e) => setTiktok((t) => ({ ...t, [key]: e.target.checked }))} />
                  {k[0].toUpperCase() + k.slice(1)}
                </label>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs mt-2">
            <label className="inline-flex items-center gap-1 cursor-pointer">
              <input type="checkbox" name="tiktok_ai_TIKTOK" checked={tiktok.aiGenerated} onChange={(e) => setTiktok((t) => ({ ...t, aiGenerated: e.target.checked }))} />
              AI-generated content
            </label>
            <label className="inline-flex items-center gap-1.5">
              Disclose
              <select name="tiktok_commercial_TIKTOK" value={tiktok.commercial} onChange={(e) => setTiktok((t) => ({ ...t, commercial: e.target.value as TikTokOptions["commercial"] }))}
                className="border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs">
                {TIKTOK_COMMERCIAL.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="inline-flex items-center gap-1 cursor-pointer">
              <input type="checkbox" name="tiktok_draft_TIKTOK" checked={tiktok.draft} onChange={(e) => setTiktok((t) => ({ ...t, draft: e.target.checked }))} />
              Hold as draft in TikTok (finish it in the app)
            </label>
          </div>
          {brandedSelfOnly && <p className="text-[11px] mt-1.5 mb-0" style={{ color: "var(--rose-on)" }}>Branded content can&apos;t be “Only me” — widen the audience or change the disclosure.</p>}
          <p className="text-[10px] text-[var(--mute)] mt-2 mb-0">
            By posting, you agree to TikTok&apos;s{" "}
            <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer" className="underline">Music Usage Confirmation</a>
            {tiktok.commercial === "brand_content" && <> and <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer" className="underline">Branded Content Policy</a></>}.
            {" "}It can take a few minutes for a video to appear on the profile.
          </p>
        </div>
      )}

      {/* Per-network customization + live counts */}
      {selectedProviders.length > 0 && (
        <div className="flex flex-col gap-2">
          {/* One click writes a version per network that needs one. Proposes —
              each variant lands in its row with Use it / Discard. */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              className="btn sm"
              disabled={tailorBusy || text.trim().length < 20}
              onClick={tailorForNetworks}
              title="Rewrite the base post for each network's length and conventions"
            >
              {tailorBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              {tailorBusy ? "Tailoring…" : "Tailor per network with AI"}
            </button>
            {Object.keys(proposed).length > 0 && (
              <>
                <button
                  type="button"
                  className="btn sm primary"
                  onClick={() => selectedProviders.forEach((p) => acceptProposal(p))}
                >
                  <Check className="w-3.5 h-3.5" /> Use all {Object.keys(proposed).length}
                </button>
                <button type="button" className="btn sm" onClick={() => { setProposed({}); setTailorNote(null); }}>
                  Discard all
                </button>
              </>
            )}
            {text.trim().length < 20 && (
              <span className="text-[11px] text-[var(--mute)]">Write the base post first.</span>
            )}
          </div>
          {tailorError && <p className="text-[11px]" style={{ color: "var(--amber-on)" }}>{tailorError}</p>}
          {tailorNote && <p className="text-[11px] text-[var(--mute)]">{tailorNote}</p>}
          {selectedProviders.map((p) => {
            const net = networkFor(p);
            const limit = net?.charLimit ?? 3000;
            const isCustom = customizing.has(p);
            const sentLen = postLength(p, sendFor(p).text);
            const over = sentLen > limit;
            const how = lengthNote(p);
            const mediaCount = effectiveMediaCount(p);
            const media = previewImagesFor(p);
            const hasVideo = media.some((m) => m.video);
            const vFiles = variantFiles[p] ?? [];
            return (
              <div key={p} className="rounded-lg border border-[var(--line)] p-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="w-2 h-2 rounded-full" style={{ background: net?.color ?? "var(--mute)" }} />
                  <span className="text-xs font-semibold">{net?.label ?? p}</span>
                  <WithTip text={SOCIAL_TIPS.charCount} side="bottom" wide>
                    <span className="font-mono text-[11px]" style={{ color: over ? "var(--rose-on)" : "var(--mute)" }} title={how ?? "As sent, links tagged"} data-char-count={p}>
                      {sentLen}/{limit}{how ? " weighted" : ""}{over ? " — over limit" : ""}
                    </span>
                  </WithTip>
                  {mediaCount > 0 && (
                    <span className="font-mono text-[10px] text-[var(--mute)]">
                      {mediaWords(media)}{isCustom && vFiles.length > 0 ? " (own)" : ""}
                    </span>
                  )}
                  {/* YouTube takes a video only — said here rather than let the
                      leg fail at send (SOC-13); the save refuses it too. */}
                  {net?.requiresVideo ? (
                    !hasVideo && <span className="text-[11px] text-[var(--amber-on)]" title={`${net.label} takes a video — attach an MP4, MOV or WebM.`} data-needs-video={p}>needs a video</span>
                  ) : net?.requiresMedia && mediaCount === 0 && (
                    <WithTip text={SOCIAL_TIPS.needsImage} side="bottom" wide>
                      <span className="text-[11px] text-[var(--amber-on)]">needs an image</span>
                    </WithTip>
                  )}
                  {/* X sends a video on its own (E-SOC-08); its length is checked on save. */}
                  {net?.provider === "twitter" && hasVideo && media.length > 1 && (
                    <span className="text-[11px] text-[var(--rose-on)]" data-x-video-alone="">takes one video on its own</span>
                  )}
                  {/* Story / Reel, but only where the network takes a choice.
                      Most don't: YouTube detects Shorts from duration and
                      aspect ratio, TikTok follows the media. Offering a picker
                      there would be inventing a control. */}
                  {subFormatsFor(p).length > 0 && (
                    <label className="inline-flex items-center gap-1 text-[11px] text-[var(--mute)]">
                      Publish as
                      <select
                        name={`subformat_${p}`}
                        value={subFormats[p] ?? ""}
                        onChange={(e) => setSubFormats((v) => ({ ...v, [p]: e.target.value }))}
                        className="border border-[var(--line-2)] rounded px-1 py-0.5 text-[11px]"
                      >
                        {/* A Reel needs a video — the save refuses one without. */}
                        {subFormatsFor(p).map((o) => (
                          <option key={o.value} value={o.value} title={o.hint}>
                            {o.label}{o.requiresVideo ? " (needs a video)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {AUTOMATIC_SUB_FORMAT[p.toLowerCase()] && (
                    <WithTip text={AUTOMATIC_SUB_FORMAT[p.toLowerCase()]} side="bottom" wide>
                      <span className="text-[11px] text-[var(--mute)]">format: automatic</span>
                    </WithTip>
                  )}
                  <span className="flex-1" />
                  <WithTip text={SOCIAL_TIPS.customize} side="left" wide>
                    <button type="button" onClick={() => toggleCustom(p)} className="text-[11px] font-semibold inline-flex items-center gap-1" style={{ color: "var(--accent)" }}>
                      {isCustom ? <><RotateCcw className="w-3 h-3" /> Use base</> : <><Pencil className="w-3 h-3" /> Customize</>}
                    </button>
                  </WithTip>
                </div>
                {/* A proposed AI variant for this network — accept or discard;
                    the author's own text is never overwritten silently. */}
                {proposed[p.toLowerCase()] && (
                  <div className="mt-2 rounded-lg p-2" style={{ background: "var(--accent-soft)" }}>
                    <div className="flex items-center gap-2 mb-1">
                      <Wand2 className="w-3 h-3" style={{ color: "var(--accent-on)" }} />
                      <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: "var(--accent-on)" }}>
                        Suggested for {net?.label ?? p} · {proposed[p.toLowerCase()].length}/{limit}
                      </span>
                      <span className="flex-1" />
                      <button type="button" className="btn sm primary" onClick={() => acceptProposal(p)}>
                        <Check className="w-3 h-3" /> Use it
                      </button>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => setProposed((prev) => { const c = { ...prev }; delete c[p.toLowerCase()]; return c; })}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="text-xs whitespace-pre-wrap">{proposed[p.toLowerCase()]}</p>
                  </div>
                )}
                {isCustom && (
                  <>
                    <input type="hidden" name={`custom_${p}`} value="1" />
                    <textarea
                      name={`variant_${p}`}
                      value={variants[p] ?? ""}
                      onChange={(e) => setVariants((v) => ({ ...v, [p]: e.target.value }))}
                      rows={3}
                      placeholder={`Text just for ${net?.label ?? p}…`}
                      className="w-full border border-[var(--line-2)] rounded-lg p-2 text-sm mt-2 resize-y"
                    />
                    <div className="flex items-center gap-2 flex-wrap mt-2">
                      <label className="btn sm cursor-pointer">
                        <ImagePlus className="w-4 h-4" /> Image or video for {net?.label ?? p}
                        <input
                          ref={(el) => { variantInputs.current[p] = el; }}
                          type="file" name={`media_${p}`} accept={MEDIA_ACCEPT} multiple className="sr-only"
                          onChange={(e) => setVariantFiles((v) => ({ ...v, [p]: Array.from(e.target.files ?? []).slice(0, 4) }))}
                        />
                      </label>
                      {vFiles.length === 0 && <span className="text-[11px] text-[var(--mute)]">using the base image{files.length === 1 ? "" : "s"}</span>}
                      {FIRST_COMMENT_NETWORKS.has(p.toLowerCase()) && (
                        <textarea
                          name={`firstcomment_${p}`}
                          value={ownComments[p] ?? ""}
                          onChange={(e) => setOwnComments((v) => ({ ...v, [p]: e.target.value }))}
                          rows={2}
                          maxLength={2000}
                          placeholder={`First comment just for ${net?.label ?? p} (blank = the shared one)`}
                          className="w-full border border-[var(--line-2)] rounded-lg p-2 text-xs resize-y"
                        />
                      )}
                      {vFiles.length > 0 && (
                        <div className="flex items-start gap-2 flex-wrap">
                          {vFiles.map((f, i) => (
                            <FileThumb key={i} file={f} url={variantFileUrls[p]?.[i]}
                              onRemove={() => { const next = vFiles.filter((_, j) => j !== i); setVariantFiles((v) => ({ ...v, [p]: next })); syncInput(variantInputs.current[p], next); }} />
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Per-platform preview — how the post will read on each selected
          network, using the same effective text/media fallbacks the server
          applies. An approximation of each network's card, not a screenshot. */}
      {selectedProviders.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="text-[11px] font-semibold inline-flex items-center gap-1"
            style={{ color: "var(--accent)" }}
          >
            {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {showPreview ? "Hide previews" : `Preview on ${selectedProviders.length} network${selectedProviders.length > 1 ? "s" : ""}`}
          </button>
          {showPreview && (
            <div className="grid gap-3 mt-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
              {selectedProviders.map((p) => {
                const account = accounts.find((a) => selected.has(a.id) && a.provider.toUpperCase() === p);
                return (
                  <PlatformPreview
                    key={p}
                    provider={p}
                    accountName={account?.name ?? null}
                    text={sendFor(p).text}
                    comment={sendFor(p).comment}
                    images={previewImagesFor(p)}
                  />
                );
              })}
            </div>
          )}
          {showPreview && (
            <p className="text-[10px] text-[var(--mute)] mt-1.5">
              Approximate rendering — networks apply their own fonts and cropping. The text is what will be sent:
              {utmCfg?.enabled ? " links carry the tags added at send," : " link tagging is off (Settings → Schedule),"} and a first comment shows where the
              network takes one.
            </p>
          )}
        </div>
      )}

      {/* Existing images — an edit keeps them unless you say otherwise. */}
      {editing && initial!.existingMedia > 0 && (
        <label className="inline-flex items-center gap-2 text-xs text-[var(--mute)]">
          <input type="checkbox" name="clearMedia" checked={clearMedia} onChange={(e) => setClearMedia(e.target.checked)} />
          Remove the {initial!.existingMedia} file{initial!.existingMedia === 1 ? "" : "s"} already on this post
          <span className="text-[10px]">(attaching new ones replaces them anyway)</span>
        </label>
      )}

      {tooBig && (
        <p className="text-xs m-0" style={{ color: "var(--rose-on)" }} data-upload-too-big="">
          These files come to {Math.round(uploadBytes / 1024 / 1024)} MB, and one post can carry {UPLOAD_LIMIT / 1024 / 1024} MB. Remove one, or attach a shorter video.
        </p>
      )}

      {/* Schedule + submit */}
      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-3">
        {editing ? (
          <>
            {/* An existing post is saved, not sent — publishing stays an
                explicit act from the queue, so an edit can never fire it. */}
            <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="radio" name="when" value="draft" checked={when === "draft"} onChange={() => setWhen("draft")} /> Keep as draft
            </label>
            <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="radio" name="when" value="schedule" checked={when === "schedule"} onChange={() => setWhen("schedule")} /> Schedule
            </label>
          </>
        ) : (
          <>
            {/* Without an account there is nowhere to send — draft is the only
                honest option, so the send choices don't render at all. */}
            {!noAccounts && (
              <>
                <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" name="when" value="now" checked={when === "now"} onChange={() => setWhen("now")} /> Post now
                </label>
                <HelpTip text={SOCIAL_TIPS.postNow} />
                <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" name="when" value="schedule" checked={when === "schedule"} onChange={() => setWhen("schedule")} /> Schedule
                </label>
                <HelpTip text={SOCIAL_TIPS.schedule} />
              </>
            )}
            <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="radio" name="when" value="draft" checked={when === "draft"} onChange={() => setWhen("draft")} /> Save as draft
            </label>
          </>
        )}
        {/* Add to queue — offered only when there IS a free slot to take, so the
            option never promises a time the schedule can't supply. */}
        {queue?.nextFree && (
          <>
            <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="radio" name="when" value="queue" checked={when === "queue"} onChange={() => setWhen("queue")} />
              Add to queue
              <span className="font-mono text-[11px] text-[var(--mute)]">{queue.nextFree}</span>
            </label>
            {/* Sibling, not a child of the label — see the Topic tip above. */}
            <HelpTip text={SOCIAL_TIPS.queue} wide />
          </>
        )}
        {queue && !queue.nextFree && queue.hasSlots && (
          <span className="text-[11px]" style={{ color: "var(--amber-on)" }}>
            Queue full — every slot ahead is taken.
          </span>
        )}
        {/* Optimal — the MEASURED best time (social/optimal.ts), or a plain
            statement of why there isn't one yet. Never a guessed hour. */}
        {!noAccounts && optimalPick && (
          <>
            <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer" title={optimalPick.why}>
              <input type="radio" name="when" value="optimal" checked={when === "optimal"} onChange={() => setWhen("optimal")} />
              Optimal
              <span className="font-mono text-[11px] text-[var(--mute)]">{optimalPick.label}</span>
            </label>
          </>
        )}
        {!noAccounts && optimal && "reason" in optimal && (
          <WithTip text={optimal.reason} side="top" wide>
            <span className="text-[11px] text-[var(--mute)] underline decoration-dotted">Optimal: not measured yet</span>
          </WithTip>
        )}
        {when === "schedule" && (
          <label className="flex items-center gap-1.5">
            <input
              type="datetime-local"
              name="scheduledAt"
              defaultValue={initial?.scheduledAtLocal ?? undefined}
              className="border border-[var(--line-2)] rounded-lg p-1.5 text-sm font-mono"
            />
            {queue?.timeZone && <span className="font-mono text-[11px] text-[var(--mute)]">{queue.timeZone}</span>}
          </label>
        )}
        <span className="flex-1" />
        {approvalNotice && (
          <span className="text-[11px]" style={{ color: "var(--amber-on)" }}>
            Held for approval before it goes out
          </span>
        )}
        {overBlocks && (
          <span className="text-[11px]" style={{ color: "var(--rose-on)" }}>
            Over a network&apos;s limit — shorten it, customize that network, or save as draft.
          </span>
        )}
        {tiktokBlocks && (
          <span className="text-[11px]" style={{ color: "var(--rose-on)" }}>
            Choose who can view the TikTok video — or save as draft.
          </span>
        )}
        <SubmitButton
          className="btn primary"
          // A DRAFT needs no account — the server accepts account-less drafts
          // and the page promises "you can still write and save drafts". The
          // button used to be disabled whenever nothing was ticked, so a
          // workspace with no accounts could never save one (found 2026-10-17).
          disabled={(selected.size === 0 && when !== "draft") || overBlocks || tiktokBlocks || (brandedSelfOnly && when !== "draft")}
          pendingText={editing ? "Saving…" : when === "queue" ? "Queueing…" : when === "schedule" || when === "optimal" ? "Scheduling…" : when === "draft" ? "Saving…" : "Posting…"}
        >
          {editing ? (
            <><Pencil className="w-4 h-4" /> Save changes</>
          ) : when === "queue" ? (
            <><ListPlus className="w-4 h-4" /> Add to queue</>
          ) : when === "optimal" ? (
            <><CalendarClock className="w-4 h-4" /> Schedule at the best time</>
          ) : when === "schedule" ? (
            <><CalendarClock className="w-4 h-4" /> Schedule</>
          ) : when === "draft" ? (
            <><Pencil className="w-4 h-4" /> Save draft</>
          ) : (
            <><Send className="w-4 h-4" /> Post now</>
          )}
        </SubmitButton>
      </div>
    </form>
  );
}

/**
 * One network's preview card. Deliberately an APPROXIMATION built from the
 * network's own facts (color, label, char limit, image-first layouts) rather
 * than a pixel-clone of its feed — clones rot the moment a network redesigns,
 * and a stale clone is worse than an honest sketch.
 */
function PlatformPreview({
  provider,
  accountName,
  text,
  comment,
  images,
}: {
  provider: string;
  accountName: string | null;
  text: string;
  /** The first comment as it will be posted (links moved there, tags added), or null where there's none. */
  comment: string | null;
  images: PreviewMedia[];
}) {
  const net = networkFor(provider);
  const limit = net?.charLimit ?? 3000;
  const length = postLength(provider, text);
  const truncated = length > limit;
  // X's weighting can't be cut by characters — say how far over instead of slicing.
  const weighted = !!lengthNote(provider);
  const shown = truncated && !weighted ? text.slice(0, limit) : text;
  const slug = provider.toLowerCase();
  const imageFirst = ["instagram", "pinterest", "tiktok"].includes(slug);
  const square = imageFirst;
  const name = accountName ?? net?.label ?? provider;

  const imageBlock =
    images.length > 0 ? (
      <div className={images.length > 1 ? "grid grid-cols-2 gap-0.5" : ""}>
        {images.slice(0, 4).map((m, i) =>
          m.video ? (
            <video key={i} src={m.url} muted controls preload="metadata" className={`w-full object-cover bg-black ${square ? "aspect-square" : "aspect-video"}`} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={m.url}
              alt=""
              className={`w-full object-cover ${square ? "aspect-square" : "aspect-video"}`}
            />
          ),
        )}
      </div>
    ) : imageFirst ? (
      <div className="aspect-square grid place-items-center text-[11px]" style={{ background: "var(--zebra)", color: "var(--amber-on)" }}>
        {net?.label} needs an image
      </div>
    ) : null;

  return (
    <div className="rounded-xl border border-[var(--line)] overflow-hidden text-sm" style={{ background: "var(--panel)" }}>
      {/* Network strip */}
      <div className="px-3 py-1.5 flex items-center gap-1.5 border-b border-[var(--line)]">
        <span className="w-2 h-2 rounded-full" style={{ background: net?.color ?? "var(--mute)" }} />
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--mute)]">{net?.label ?? provider}</span>
      </div>
      {/* Author row */}
      <div className="px-3 pt-2.5 pb-1.5 flex items-center gap-2">
        <span
          className="w-8 h-8 rounded-full grid place-items-center text-xs font-bold shrink-0"
          style={{ background: net?.color ?? "var(--mute)", color: "#fff" }}
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="text-xs font-semibold truncate">{name}</div>
          <div className="text-[10px] text-[var(--mute)]">Just now</div>
        </div>
      </div>
      {imageFirst && imageBlock}
      {shown && (
        <p className="px-3 py-2 text-[13px] whitespace-pre-wrap break-words leading-snug">
          {shown}
          {truncated && <span style={{ color: "var(--rose-on)" }}>{weighted ? ` — ${length - limit} over ${net?.label ?? provider}'s ${limit}` : `… ✂ cut at ${limit} characters`}</span>}
        </p>
      )}
      {!imageFirst && imageBlock}
      <div className="px-3 py-1.5 border-t border-[var(--line)] flex gap-4 text-[10px] font-mono text-[var(--mute)]">
        <span>Like</span><span>Comment</span><span>Share</span>
      </div>
      {comment && (
        <div className="px-3 py-2 border-t border-[var(--line)] flex gap-2 items-start" data-preview-comment={provider}>
          <span className="w-5 h-5 rounded-full shrink-0 grid place-items-center text-[9px] font-bold" style={{ background: net?.color ?? "var(--mute)", color: "#fff" }}>{name.slice(0, 1).toUpperCase()}</span>
          <p className="m-0 text-[12px] whitespace-pre-wrap break-words leading-snug min-w-0"><span className="font-semibold">First comment · </span>{comment}</p>
        </div>
      )}
    </div>
  );
}
