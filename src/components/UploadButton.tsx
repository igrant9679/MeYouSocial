"use client";

import { useState, useRef } from "react";
import { Paperclip, Loader2 } from "lucide-react";

export type UploadResult = { id: string; title: string; words: number };

/**
 * Upload a file (≤10MB: PDF / Word / text / image) as research on a channel,
 * a script or a chat. By default the page reloads afterwards so a
 * server-rendered context list refreshes; pass `reload={false}` and use
 * `onDone` where the caller can show the result itself (the assistant).
 */
export function UploadButton({ chatId, scriptId, channelId, onDone, reload = true, compact = false }: { chatId?: string; scriptId?: string; channelId?: string; onDone?: (r: UploadResult) => void; reload?: boolean; compact?: boolean }) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handle(file: File) {
    setErr(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      if (chatId) fd.set("chatId", chatId);
      if (scriptId) fd.set("scriptId", scriptId);
      if (channelId) fd.set("channelId", channelId);
      const res = await fetch("/api/uploads", { method: "POST", body: fd });
      const json = (await res.json()) as { error?: string; id?: string; words?: number; title?: string };
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      onDone?.({ id: json.id ?? "", title: json.title ?? file.name, words: json.words ?? 0 });
      // Reload so a server-rendered context list refreshes.
      if (reload) window.location.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => ref.current?.click()}
        className="btn sm flex items-center gap-1.5"
        title="Attach a file (≤10MB · PDF / Word / text / image) — it is saved as research on the channel"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
        {busy ? "Uploading…" : compact ? "Attach" : "Upload file"}
      </button>
      <input
        ref={ref}
        type="file"
        hidden
        accept=".pdf,.doc,.docx,.txt,.md,.json,.csv,.jpg,.jpeg,.png,.gif,.webp"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handle(f);
        }}
      />
      {err && <span className="text-[10px] text-[var(--brand)]">{err}</span>}
      {!compact && <span className="text-[10px] text-[var(--mute)]">≤10MB · PDF / Word / text / image</span>}
    </div>
  );
}
