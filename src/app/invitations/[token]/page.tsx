import { redirect } from "next/navigation";
import { SubmitButton } from "@/components/SubmitButton";
import Link from "next/link";
import { auth } from "@/auth";
import { db } from "@/lib/db";

// invitee accepts and joins the workspace with the role from the invite.

async function acceptAction(token: string) {
  "use server";
  const session = await auth();
  if (!session?.user?.id) redirect(`/signin?next=/invitations/${token}`);
  const invite = await db.invitation.findUnique({ where: { token } });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) redirect("/forbidden");

  await db.$transaction([
    db.membership.upsert({
      where: { userId_workspaceId: { userId: session!.user!.id, workspaceId: invite.workspaceId } },
      update: { role: invite.role, status: "active" },
      create: { userId: session!.user!.id, workspaceId: invite.workspaceId, role: invite.role },
    }),
    db.invitation.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } }),
  ]);
  redirect("/dashboard");
}

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await db.invitation.findUnique({ where: { token }, include: { workspace: true } });

  if (!invite) {
    return <div className="flex-1 grid place-items-center p-6"><div className="card max-w-md text-center"><h1 className="font-mono font-bold mb-2">Invalid invitation</h1></div></div>;
  }
  if (invite.acceptedAt) {
    return <div className="flex-1 grid place-items-center p-6"><div className="card max-w-md text-center"><h1 className="font-mono font-bold mb-2">Already accepted</h1><Link className="btn primary" href="/dashboard">Go to dashboard</Link></div></div>;
  }
  if (invite.expiresAt < new Date()) {
    return <div className="flex-1 grid place-items-center p-6"><div className="card max-w-md text-center"><h1 className="font-mono font-bold mb-2">Expired</h1><p className="text-sm text-[var(--mute)]">Ask your admin for a new invite.</p></div></div>;
  }

  return (
    <div className="flex-1 grid place-items-center p-6">
      <div className="card max-w-md text-center">
        <h1 className="font-mono font-bold text-xl mb-2">You&apos;re invited</h1>
        <p className="text-sm text-[var(--mute)] mb-1">to <b>{invite.workspace.name}</b> on MeYouSocial</p>
        <p className="text-xs font-mono text-[var(--mute)] mb-4">Role: {invite.role}</p>
        <form action={acceptAction.bind(null, token)}>
          <SubmitButton className="btn primary">Accept invitation</SubmitButton>
        </form>
        <p className="text-xs text-[var(--mute)] mt-4">
          New? <Link href={`/signup?invite=${token}`} className="text-[var(--accent)] font-semibold">Create an account first</Link>
        </p>
      </div>
    </div>
  );
}
