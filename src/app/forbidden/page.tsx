import Link from "next/link";

// Why the page refused, from what the redirect said (SHL-12: it always blamed
// the role, including for workspaces the person isn't in and operator pages).
const WHY: Record<string, string> = {
  ADMIN: "That page is for this workspace's admins. An admin can open it, or change your role under Settings → People.",
  EDITOR: "That page is for editors and admins of this workspace — a viewer can read, not change. An admin can change your role under Settings → People.",
  operator: "That page is for the platform operator only.",
  member: "You aren't a member of that workspace, or your invitation hasn't been accepted yet.",
};

export default async function ForbiddenPage({ searchParams }: { searchParams: Promise<{ need?: string; why?: string }> }) {
  const { need, why } = await searchParams;
  const text = WHY[need ?? ""] ?? WHY[why ?? ""] ?? "Your access here doesn't include that page.";
  return (
    <div className="flex-1 grid place-items-center p-6">
      <div className="card max-w-md text-center">
        <h1 className="font-mono font-bold text-xl mb-2">Not allowed</h1>
        <p className="text-sm text-[var(--mute)] mb-4">{text}</p>
        <Link href="/inbox" className="btn primary">Back to Inbox</Link>
      </div>
    </div>
  );
}
