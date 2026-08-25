import Link from "next/link";
import { redirect } from "next/navigation";
import { getActiveChannel } from "@/lib/channel";
import { createScriptAction } from "@/app/actions/canvas";
import { SubmitButton } from "@/components/SubmitButton";

// The "+ New script" buttons always linked here, but the route never existed
// (every script was born from an idea, a chat, or the API) — so the primary
// button on two pages was a 404. A blank script only needs a title and a
// choice of editor; everything else comes from the channel's defaults.

export default async function NewScriptPage() {
  const { active } = await getActiveChannel();
  // No channel yet → /scripts renders its "create your first channel" card.
  if (!active) redirect("/scripts");

  return (
    <div className="card max-w-md mx-auto">
      <h1 className="font-mono font-bold text-lg mb-1">New script</h1>
      <p className="text-sm text-[var(--mute)] mb-4">
        Starts in <b>{active.name}</b> with the channel&apos;s language, template and model defaults.
      </p>
      <form action={createScriptAction} className="flex flex-col gap-3">
        <input type="hidden" name="channelId" value={active.id} />
        <label className="text-xs font-semibold">
          Title
          <input
            name="title"
            required
            maxLength={200}
            placeholder="Working title — you can change it any time"
            className="mt-1 w-full border border-[var(--line-2)] rounded-lg p-2 text-sm font-normal"
          />
        </label>
        <label className="text-xs font-semibold">
          Editor
          <select
            name="workflow"
            className="mt-1 w-full border border-[var(--line-2)] rounded-lg p-2 text-sm font-normal"
            defaultValue="canvas"
          >
            <option value="canvas">Canvas — chat-assisted writing</option>
            <option value="builder">Builder — classic step-by-step</option>
          </select>
        </label>
        <div className="flex items-center gap-2 mt-1">
          <SubmitButton className="btn primary" pendingText="Creating…">Create script</SubmitButton>
          <Link href={`/channels/${active.id}/scripts`} className="btn">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
