"use client";

import { useRef, useState } from "react";
import { Paperclip, Loader2, X } from "lucide-react";
import { formatBytes, UPLOAD_ACCEPT, UPLOAD_MAX_BYTES } from "@/lib/documents/kinds";

export type UploadResult = { id: string; title: string; words: number };

/** How long one piece may keep failing before the upload stops and says so: about four minutes of retries. */
const PIECE_RETRIES = 9;
const backoff = (n: number) => Math.min(30_000, 1000 * 2 ** n);
/** How long the button waits for a reading before saying it carries on without it. */
const READ_WAIT_MS = 3 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Progress = { sent: number; total: number; startedAt: number; from: number };

/** "about 12 min left", once the speed means something. */
function timeLeft(p: Progress): string {
  const seconds = (Date.now() - p.startedAt) / 1000;
  const rate = (p.sent - p.from) / Math.max(seconds, 0.001);
  if (seconds < 5 || rate <= 0) return "";
  const left = (p.total - p.sent) / rate;
  return left < 90 ? ` · about ${Math.max(1, Math.round(left))} s left` : ` · about ${Math.round(left / 60)} min left`;
}

async function jsonOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

/**
 * Attach a file (up to 2,500 MB: PDF, Word, text or an image) as research on a
 * channel, a script or a chat (E-ENG-13). It goes up in pieces, each its own
 * request — Railway gives a request body five minutes — so a dropped connection
 * costs one piece, and attaching the same file again carries on where it stopped.
 * By default the page reloads afterwards so a server-rendered context list
 * refreshes; pass `reload={false}` and use `onDone` where the caller can show the
 * result itself (the assistant).
 */
export function UploadButton({ chatId, scriptId, channelId, onDone, reload = true, compact = false }: { chatId?: string; scriptId?: string; channelId?: string; onDone?: (r: UploadResult) => void; reload?: boolean; compact?: boolean }) {
  const ref = useRef<HTMLInputElement | null>(null);
  const cancelled = useRef<(() => void) | null>(null);
  const stoppedHere = useRef(false);
  const [phase, setPhase] = useState<"idle" | "uploading" | "reading">("idle");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function send(file: File): Promise<boolean> {
    const start = await fetch("/api/uploads/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: file.name, size: file.size, type: file.type, lastModified: file.lastModified, chatId, scriptId, channelId }),
    });
    const begun = await jsonOf(start);
    if (!start.ok) throw new Error(String(begun.error ?? "The upload couldn't be started."));
    const id = String(begun.id);
    const chunk = Number(begun.chunkSize);
    let sent = Number(begun.received ?? 0);
    const from = sent;
    const startedAt = Date.now();

    const abort = new AbortController();
    let stopped = false;
    cancelled.current = () => {
      stopped = true;
      stoppedHere.current = true;
      abort.abort();
      void fetch(`/api/uploads/sessions/${id}`, { method: "DELETE" }).catch(() => {});
    };

    let tries = 0;
    while (sent < file.size) {
      setProgress({ sent, total: file.size, startedAt, from });
      try {
        const res = await fetch(`/api/uploads/sessions/${id}?offset=${sent}`, { method: "PUT", body: file.slice(sent, sent + chunk), signal: abort.signal });
        const json = await jsonOf(res);
        // 409: its reply went missing last time, so the server is further on than this was.
        if (res.ok || res.status === 409) {
          sent = Number(json.received ?? sent);
          tries = 0;
          continue;
        }
        if (res.status !== 503 && res.status !== 429) throw Object.assign(new Error(String(json.error ?? "The upload failed.")), { fatal: true });
      } catch (e) {
        if (stopped) return false;
        if ((e as { fatal?: boolean }).fatal) throw e;
      }
      if (++tries > PIECE_RETRIES) {
        throw new Error(`The connection dropped at ${Math.floor((sent / file.size) * 100)}%. Attach the same file again to carry on from there.`);
      }
      await sleep(backoff(tries));
      if (stopped) return false;
      // What really arrived: the reply was lost, not necessarily the piece.
      const check = await fetch(`/api/uploads/sessions/${id}`).catch(() => null);
      if (check?.ok) sent = Number((await jsonOf(check)).received ?? sent);
      else if (check?.status === 410 || check?.status === 404) throw new Error("This upload has expired. Attach the file again.");
    }
    setProgress({ sent, total: file.size, startedAt, from });

    setPhase("reading");
    cancelled.current = null;
    let done: Response | null = null;
    for (let i = 0; i < 5 && !done?.ok; i++) {
      done = await fetch(`/api/uploads/sessions/${id}`, { method: "POST" }).catch(() => null);
      if (!done?.ok) await sleep(backoff(i));
    }
    const finished = done ? await jsonOf(done) : {};
    if (!done?.ok) throw new Error(String(finished.error ?? "The file arrived, but it couldn't be saved as research. Attach it again to retry."));
    const sourceId = String(finished.id);

    // The reading happens in the background; this only waits to say how it went.
    let words = 0;
    let state = "reading";
    let said: string | null = null;
    const waitStarted = Date.now();
    while (state === "reading" && Date.now() - waitStarted < READ_WAIT_MS) {
      await sleep(state === "reading" && Date.now() - waitStarted < 5000 ? 700 : 3000);
      const res = await fetch(`/api/uploads/sources/${sourceId}`).catch(() => null);
      if (!res?.ok) continue;
      const json = await jsonOf(res);
      state = String(json.state);
      words = Number(json.words ?? 0);
      said = json.note ? String(json.note) : null;
    }
    if (state === "reading") said = "Saved. It's still being read — that carries on without this page, and the channel's Research page shows when it's done.";
    onDone?.({ id: sourceId, title: file.name, words });
    if (said) {
      setNote(said);
      return false;
    }
    return true;
  }

  async function handle(file: File) {
    setErr(null);
    setNote(null);
    if (file.size > UPLOAD_MAX_BYTES) {
      setErr(`That file is ${formatBytes(file.size)}. The most that can be attached is ${formatBytes(UPLOAD_MAX_BYTES)}.`);
      if (ref.current) ref.current.value = "";
      return;
    }
    setPhase("uploading");
    setProgress(null);
    stoppedHere.current = false;
    const leaving = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", leaving);
    try {
      // A caveat (not read, read in part) stays on screen instead of vanishing in the reload.
      const clean = await send(file);
      if (clean && reload) window.location.reload();
      if (stoppedHere.current) setNote("Stopped — nothing was kept.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      window.removeEventListener("beforeunload", leaving);
      cancelled.current = null;
      setPhase("idle");
      setProgress(null);
      if (ref.current) ref.current.value = "";
    }
  }

  const percent = progress ? Math.floor((progress.sent / Math.max(progress.total, 1)) * 100) : 0;
  const busy = phase !== "idle";
  // A file of one piece has no story to tell: only a big one earns a bar.
  const big = !!progress && progress.total > 8 * 1024 * 1024;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => ref.current?.click()}
          className="btn sm flex items-center gap-1.5"
          title={`Attach a file (up to ${formatBytes(UPLOAD_MAX_BYTES)}: PDF, Word, text, Markdown, CSV, JSON or an image) — it is saved as research on the channel, and read so the assistant can use it`}
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
          {phase === "reading" ? "Reading…" : phase === "uploading" ? (big ? `${percent}%` : "Uploading…") : compact ? "Attach" : "Upload file"}
        </button>
        {phase === "uploading" && big && (
          <button type="button" className="btn sm" title="Stop this upload" aria-label="Stop this upload" onClick={() => cancelled.current?.()}>
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <input
        ref={ref}
        type="file"
        hidden
        accept={UPLOAD_ACCEPT}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handle(f);
        }}
      />
      {phase === "uploading" && big && progress && (
        <div className="min-w-40" data-upload-progress={percent}>
          <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
            <div className="h-full" style={{ width: `${percent}%`, background: "var(--accent)" }} />
          </div>
          <span className="text-micro text-[var(--mute)]">{formatBytes(progress.sent)} of {formatBytes(progress.total)}{timeLeft(progress)} — keep this page open</span>
        </div>
      )}
      {err && <span className="text-micro text-[var(--brand)]" data-upload-error="">{err}</span>}
      {note && <span className="text-micro" style={{ color: "var(--amber-on)" }} data-upload-note="">{note}</span>}
      {!compact && !busy && <span className="text-micro text-[var(--mute)]">Up to {formatBytes(UPLOAD_MAX_BYTES)} · PDF / Word / text / image</span>}
    </div>
  );
}
