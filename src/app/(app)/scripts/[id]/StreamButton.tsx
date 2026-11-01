"use client";

import { useState, useRef } from "react";
import { Sparkles, Loader2 } from "lucide-react";

/** Triggers a streaming generation and shows live tokens. On completion the page reloads
 *  so the persisted body (saved server-side) becomes visible. */
export function StreamButton({ scriptId, stage, label }: { scriptId: string; stage: "outline" | "script"; label?: string }) {
  const [streaming, setStreaming] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const ctrl = useRef<AbortController | null>(null);

  async function go() {
    if (streaming) return;
    setText("");
    setError("");
    setStreaming(true);
    ctrl.current = new AbortController();
    try {
      const res = await fetch(`/api/scripts/${scriptId}/generate?stage=${stage}`, {
        signal: ctrl.current.signal,
        headers: { Accept: "text/event-stream" },
      });
      if (!res.ok || !res.body) throw new Error("stream failed");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const f of frames) {
          if (f.startsWith("event: done")) {
            setTimeout(() => location.reload(), 500);
            continue;
          }
          if (f.startsWith("event: error")) {
            // Nothing was saved — say why (a refused placeholder, a failed call).
            const data = f.split("\n").find((l) => l.startsWith("data: "));
            try { setError(String(JSON.parse(data?.slice(6) ?? "{}").error ?? "") || "The stream failed; nothing was saved."); } catch { setError("The stream failed; nothing was saved."); }
            continue;
          }
          const line = f.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            const json = JSON.parse(line.slice(6));
            if (json.delta) setText((t) => t + json.delta);
          } catch {}
        }
      }
    } catch {
      // user cancelled or network error — silent.
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={go}
        disabled={streaming}
        className="btn primary sm flex items-center gap-1.5"
      >
        {streaming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        {streaming ? "Streaming…" : (label ?? `Stream ${stage}`)}
      </button>
      {error && !streaming && <p className="text-xs m-0" style={{ color: "var(--rose-on)" }} role="alert" data-stream-error>{error}</p>}
      {streaming && text && (
        <pre className="border border-[var(--line-2)] rounded-lg p-3 text-xs font-mono leading-[1.5] whitespace-pre-wrap max-h-64 overflow-auto bg-[var(--zebra)]">
          {text}
          <span className="inline-block w-2 h-3 bg-[var(--accent)] ml-0.5 align-text-bottom animate-pulse" />
        </pre>
      )}
    </div>
  );
}
