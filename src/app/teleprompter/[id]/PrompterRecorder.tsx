"use client";

import { useEffect, useRef, useState } from "react";
import { Circle, Square, Video } from "lucide-react";

/**
 * Record a take at the teleprompter (E-VID-14): the camera and microphone
 * through MediaRecorder, a small self-view in the corner, and on Stop the take
 * is uploaded and saved as an Asset linked to the script's project. Nothing is
 * recorded until the presenter presses Record, and the browser asks first.
 *
 * ⚠ The camera is released on Stop and when the page goes — a lit camera
 *   light after recording reads as "still being watched".
 */

type State = { phase: "idle" | "asking" | "recording" | "saving"; note: string | null; error: string | null; takes: Array<{ name: string; url: string }> };

function pickMime(): string {
  const options = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  for (const m of options) if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  return "";
}

export function PrompterRecorder({ scriptId }: { scriptId: string }) {
  const [s, setS] = useState<State>({ phase: "idle", note: null, error: null, takes: [] });
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const preview = useRef<HTMLVideoElement>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  const release = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  useEffect(() => release, []);
  useEffect(() => {
    if (s.phase !== "recording") return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [s.phase]);

  async function start() {
    setS((p) => ({ ...p, phase: "asking", error: null, note: null }));
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't record here (it needs a secure page and camera access).");
      if (typeof MediaRecorder === "undefined") throw new Error("This browser can't record video.");
      const media = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: true });
      stream.current = media;
      if (preview.current) {
        preview.current.srcObject = media;
        void preview.current.play().catch(() => {});
      }
      const mime = pickMime();
      const rec = new MediaRecorder(media, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      rec.onstop = () => void save(rec.mimeType || mime || "video/webm");
      recorder.current = rec;
      rec.start(1000);
      const t0 = Date.now();
      setStartedAt(t0);
      setNow(t0);
      setS((p) => ({ ...p, phase: "recording" }));
    } catch (e) {
      release();
      const name = e instanceof Error ? e.name : "";
      const why = name === "NotAllowedError" ? "Camera access was refused — allow it in the browser's address bar and try again."
        : name === "NotFoundError" ? "No camera or microphone was found."
        : name === "NotReadableError" ? "The camera is busy in another app."
        : e instanceof Error ? e.message : "The camera couldn't be opened.";
      setS((p) => ({ ...p, phase: "idle", error: why }));
    }
  }

  function stop() {
    recorder.current?.stop();
    release();
    setS((p) => ({ ...p, phase: "saving" }));
  }

  async function save(mime: string) {
    const blob = new Blob(chunks.current, { type: mime.split(";")[0] });
    chunks.current = [];
    const fd = new FormData();
    fd.set("scriptId", scriptId);
    fd.set("file", new File([blob], mime.includes("mp4") ? "take.mp4" : "take.webm", { type: blob.type }));
    try {
      const res = await fetch("/api/recordings", { method: "POST", body: fd });
      const out = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; name?: string; url?: string; linked?: boolean };
      if (!res.ok || !out.ok) throw new Error(out.error ?? `The take couldn't be saved (HTTP ${res.status}).`);
      setS((p) => ({ phase: "idle", error: null, note: `Saved as “${out.name}” in Assets${out.linked ? ", linked to the project" : ""}.`, takes: [...p.takes, { name: out.name!, url: out.url! }] }));
    } catch (e) {
      setS((p) => ({ ...p, phase: "idle", error: e instanceof Error ? e.message : "The take couldn't be saved." }));
    }
  }

  const secs = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  return (
    <div className="flex items-center gap-2 text-xs font-mono" data-recorder={s.phase}>
      {s.phase === "recording" ? (
        <button type="button" onClick={stop} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-600 text-white" aria-label="Stop recording">
          <Square className="w-3 h-3" /> Stop · {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
        </button>
      ) : (
        <button type="button" onClick={start} disabled={s.phase !== "idle"} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-white/30 text-white/80 hover:text-white disabled:opacity-50" aria-label="Record a take">
          {s.phase === "saving" ? <>Saving…</> : s.phase === "asking" ? <>Opening camera…</> : <><Circle className="w-3 h-3 text-red-500" /> Record</>}
        </button>
      )}
      {s.error && <span className="text-red-300 max-w-[28vw] truncate" title={s.error} data-recorder-error="">{s.error}</span>}
      {s.note && <span className="text-emerald-300 max-w-[28vw] truncate" title={s.note} data-recorder-note=""><Video className="w-3 h-3 inline -mt-0.5" /> {s.note}</span>}
      {/* The self-view: small, bottom-right, mirrored like a mirror — only while recording. */}
      <video ref={preview} muted playsInline className="fixed bottom-4 right-4 w-48 rounded-lg border border-white/20 shadow-lg z-50 -scale-x-100" style={{ display: s.phase === "recording" ? "block" : "none" }} />
    </div>
  );
}
