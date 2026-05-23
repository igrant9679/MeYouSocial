import { redirect } from "next/navigation";
import Link from "next/link";
import { getActiveChannel } from "@/lib/channel";

export default async function ScriptsPage() {
  const { active } = await getActiveChannel();
  if (active) redirect(`/channels/${active.id}/scripts`);
  return (
    <div className="card max-w-md mx-auto text-center py-10">
      <h1 className="font-mono font-bold text-lg mb-2">No channel yet</h1>
      <p className="text-sm text-[var(--mute)] mb-4">Set up a channel to start scripting.</p>
      <Link href="/onboarding/channel/new" className="btn primary">Create your first channel</Link>
    </div>
  );
}
