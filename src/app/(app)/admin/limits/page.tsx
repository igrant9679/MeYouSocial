import { Gauge } from "lucide-react";
import { SubmitButton } from "@/components/SubmitButton";
import { requireRole } from "@/lib/acl";
import { updateSoftLimitsAction } from "@/app/actions/admin";

// Optional soft usage limits. Disabled by default; never tied to payment.

export default async function AdminLimitsPage() {
  const { workspace } = await requireRole("ADMIN");

  return (
    <div className="w-full">
      <div className="flex items-center gap-3 mb-4">
        <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: "#FBEED5", color: "#D97706" }}>
          <Gauge className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-lg leading-tight">Soft limits</h1>
          <p className="text-xs text-[var(--mute)]">Optional. <b>Never tied to payment.</b> These cap shared infrastructure cost. Leave blank or 0 for unlimited.</p>
        </div>
      </div>

      <form action={updateSoftLimitsAction} className="card flex flex-col gap-4">
        <LimitField name="scriptsPerUserMonth"    label="Scripts per user / month"        defaultValue={workspace.limitScriptsPerUserMonth} />
        <LimitField name="thumbnailsPerUserMonth" label="Thumbnails per user / month"     defaultValue={workspace.limitThumbnailsPerUserMonth} hint="Thumbnail generation is the costliest operation." />
        <LimitField name="agentRunsPerUserMonth"  label="Agent Mode runs per user / month" defaultValue={workspace.limitAgentRunsPerUserMonth} hint="Agent Mode is the heaviest pipeline." />
        <LimitField name="channels"               label="Channels per workspace"           defaultValue={workspace.limitChannels} />
        <div className="flex justify-end"><SubmitButton className="btn primary">Save limits</SubmitButton></div>
      </form>
    </div>
  );
}

function LimitField(props: { name: string; label: string; defaultValue: number | null; hint?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">{props.label}</span>
      <input type="number" name={props.name} min={0} defaultValue={props.defaultValue ?? ""} placeholder="Unlimited" className="border border-[var(--line-2)] rounded-lg p-2 text-sm w-32 font-mono" />
      {props.hint && <span className="text-[11px] text-[var(--mute)]">{props.hint}</span>}
    </label>
  );
}
