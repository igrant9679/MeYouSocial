import { Zap, Gauge, FileText } from "lucide-react";
import type { ModelDescriptor } from "@/lib/llm";

// Surface model characteristics (speed, length adherence, style)
// next to each option so creators can pick the right one for the job.

const SPEED_COLOR: Record<ModelDescriptor["speed"], string> = {
  fast:     "var(--green)",
  balanced: "var(--blue)",
  slow:     "var(--violet)",
};

const LENGTH_COLOR: Record<ModelDescriptor["lengthAdherence"], string> = {
  loose:  "var(--amber)",
  medium: "var(--blue)",
  strict: "var(--green)",
};

export function ModelChip({ model }: { model: ModelDescriptor }) {
  return (
    <span className="inline-flex items-center gap-1 text-micro font-mono uppercase tracking-wider">
      <span title={`Speed: ${model.speed}`} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded" style={{ background: `color-mix(in srgb, ${SPEED_COLOR[model.speed]} 13%, transparent)`, color: SPEED_COLOR[model.speed] }}>
        <Zap className="w-2.5 h-2.5" /> {model.speed}
      </span>
      <span title={`Length adherence: ${model.lengthAdherence}`} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded" style={{ background: `color-mix(in srgb, ${LENGTH_COLOR[model.lengthAdherence]} 13%, transparent)`, color: LENGTH_COLOR[model.lengthAdherence] }}>
        <FileText className="w-2.5 h-2.5" /> {model.lengthAdherence}
      </span>
    </span>
  );
}

// image-gen guidance hint (used on the Thumbnail Studio header).
export function ImageGenHint() {
  return (
    <span className="inline-flex items-center gap-1 text-micro font-mono uppercase tracking-wider px-2 py-0.5 rounded" style={{ background: "var(--pink-soft)", color: "var(--pink)" }}>
      <Gauge className="w-2.5 h-2.5" /> Image model
    </span>
  );
}
