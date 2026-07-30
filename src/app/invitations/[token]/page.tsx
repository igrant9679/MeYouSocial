import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SubmitButton } from "@/components/SubmitButton";
import Link from "next/link";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { ACTIVE_WS_COOKIE } from "@/lib/acl";

// Invitee accepts and joins the workspace with the role from the invite.
//
// ── Why the failure states carry real copy ──────────────────────────────────
// Every one of these is reached by someone who has just clicked a link in their
// email and has no idea what this app is. A bare "Invalid invitation" with no
// reason and no way onward — which is what this used to render — leaves them
// stuck with nothing to do but email whoever invited them. Each state now says
// what likely happened and offers a route.

async function acceptAction(token: string) {
  "use server";
  const session = await auth();
  if (!session?.user?.id) redirect(`/signin?next=/invitations/${token}`);
  const invite = await db.invitation.findUnique({ where: { token } });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    // Back to this page rather than /forbidden. The invite can be revoked or
    // expire between render and submit, and /forbidden says "your role doesn't
    // permit access to that page" — which is not what happened and sends people
    // looking for a permissions problem that doesn't exist. Re-rendering here
    // shows the state that actually applies, with its explanation.
    redirect(`/invitations/${token}`);
  }

  await db.$transaction([
    db.membership.upsert({
      where: { userId_workspaceId: { userId: session!.user!.id, workspaceId: invite.workspaceId } },
      update: { role: invite.role, status: "active" },
      create: { userId: session!.user!.id, workspaceId: invite.workspaceId, role: invite.role },
    }),
    db.invitation.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } }),
  ]);
  // Land them in the workspace they just joined, not their first membership.
  (await cookies()).set(ACTIVE_WS_COOKIE, invite.workspaceId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/dashboard");
}

function Notice({
  title,
  children,
  actions,
}: {
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex-1 grid place-items-center p-6">
      <div className="card max-w-md">
        <h1 className="font-mono font-bold text-xl mb-2 text-center">{title}</h1>
        {children && <div className="text-sm text-[var(--mute)] leading-[1.6] space-y-2">{children}</div>}
        {actions && <div className="flex flex-wrap gap-2 justify-center mt-4">{actions}</div>}
      </div>
    </div>
  );
}

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await db.invitation.findUnique({ where: { token }, include: { workspace: true } });

  // ⚠ A revoked invitation and a token that never existed are the SAME state
  // here — the row is deleted on revoke, so there is nothing left to tell them
  // apart. They're deliberately not separated: doing so would confirm to anyone
  // holding a guessed token whether it was ever real. So this names the likely
  // causes instead of asserting one, and includes the truncated-link case, which
  // is a genuine cause — mail clients wrap long URLs and the tail gets lost.
  if (!invite) {
    return (
      <Notice
        title="This invitation is no longer valid"
        actions={
          <>
            <Link href="/signin" className="btn primary">Sign in</Link>
            <Link href="/" className="btn">Home</Link>
          </>
        }
      >
        <p>Usually one of:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>It was <b>withdrawn</b>, or it has already been used.</li>
          <li>The <b>link got cut short</b> — mail clients often wrap long URLs. Check the address bar
            against the full link in the email.</li>
        </ul>
        <p>
          If you already have an account, sign in — you may not need this invitation at all. Otherwise ask
          whoever invited you to send a fresh one.
        </p>
      </Notice>
    );
  }

  if (invite.acceptedAt) {
    return (
      <Notice
        title="Already accepted"
        actions={<Link className="btn primary" href="/dashboard">Go to dashboard</Link>}
      >
        <p>
          You&apos;ve already joined <b>{invite.workspace.name}</b>. Invitations only work once — sign in
          normally from now on.
        </p>
      </Notice>
    );
  }

  if (invite.expiresAt < new Date()) {
    return (
      <Notice
        title="This invitation has expired"
        actions={
          <>
            <Link href="/signin" className="btn primary">Sign in</Link>
            <Link href="/" className="btn">Home</Link>
          </>
        }
      >
        <p>
          Your invitation to <b>{invite.workspace.name}</b> lapsed on{" "}
          <b>{invite.expiresAt.toLocaleDateString()}</b>. Invitations last seven days.
        </p>
        <p>Ask an admin of that workspace to send a new one — nothing is lost, it just needs reissuing.</p>
      </Notice>
    );
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
