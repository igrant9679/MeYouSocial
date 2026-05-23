import { redirect } from "next/navigation";
import Link from "next/link";
import { getActiveChannel } from "@/lib/channel";

// Global "Ideas" nav entry redirects to the active channel's ideas page (FR-CHAT-01
// principle — channel-scoped). If no channels exist yet, route to onboarding.

export default async function IdeasPage() {
  const { active } = await getActiveChannel();
  if (active) redirect(`/channels/${active.id}/ideas`);

  return (
    <div className="card max-w-md mx-auto text-center py-10">
      <h1 className="font-mono font-bold text-lg mb-2">No channel yet</h1>
      <p className="text-sm text-[var(--mute)] mb-4">Set up a channel to generate ideas.</p>
      <Link href="/onboarding/channel/new" className="btn primary">Create your first channel</Link>
    </div>
  );
}
