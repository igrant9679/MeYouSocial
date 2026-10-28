"use client";

import { useState, useEffect, useRef } from "react";
import { Play, Pause, Minus, Plus, RotateCcw } from "lucide-react";

// Full-screen large-text teleprompter. Auto-scroll + speed control.

export function Teleprompter({ body }: { body: string }) {
  const [scrollSpeed, setScrollSpeed] = useState(40);   // pixels / second
  const [fontSize, setFontSize] = useState(48);         // px
  const [playing, setPlaying] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    function tick(now: number) {
      const dt = (now - last) / 1000;
      last = now;
      const el = ref.current;
      if (el) {
        el.scrollTop += scrollSpeed * dt;
        // At the end, stop rather than spin.
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) { setPlaying(false); return; }
      }
      raf.current = requestAnimationFrame(tick);
    }
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [playing, scrollSpeed]);

  return (
    <div className="flex-1 min-h-0 flex flex-col relative">
      <div
        ref={ref}
        className="flex-1 min-h-0 overflow-auto px-12 py-32 text-center leading-[1.6] tracking-wide font-mono"
        style={{ fontSize, lineHeight: 1.5 }}
      >
        <div className="max-w-5xl mx-auto whitespace-pre-wrap">{body || "(empty script)"}</div>
      </div>

      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl px-4 py-2.5">
        <button onClick={() => setPlaying(!playing)} className="w-10 h-10 rounded-full grid place-items-center bg-white text-black hover:scale-105 transition" title={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
        </button>
        <Slider label="Speed" value={scrollSpeed} min={10} max={200} step={5} unit="px/s" onChange={setScrollSpeed} />
        <Slider label="Size" value={fontSize} min={24} max={96} step={2} unit="px" onChange={setFontSize} />
        <button onClick={() => { if (ref.current) ref.current.scrollTop = 0; }} className="w-9 h-9 rounded-full grid place-items-center bg-white/10 hover:bg-white/20 transition" title="Restart">
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(min, value - step))} aria-label={`Less ${label.toLowerCase()}`} className="w-7 h-7 rounded-full grid place-items-center bg-white/10 hover:bg-white/20"><Minus className="w-3.5 h-3.5" /></button>
      <div className="text-xs font-mono text-white/80 w-16 text-center"><b>{label}</b><br /><span className="opacity-70">{value} {unit}</span></div>
      <button type="button" onClick={() => onChange(Math.min(max, value + step))} aria-label={`More ${label.toLowerCase()}`} className="w-7 h-7 rounded-full grid place-items-center bg-white/10 hover:bg-white/20"><Plus className="w-3.5 h-3.5" /></button>
    </div>
  );
}
