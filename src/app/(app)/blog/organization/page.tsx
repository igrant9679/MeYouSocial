import Link from "next/link";
import { ArrowLeft, Building2 } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { db } from "@/lib/db";
import { SubmitButton } from "@/components/SubmitButton";
import { saveOrgProfileAction } from "@/app/actions/blog";

// Org profile (Spark port): "what this client does" — grounds every blog
// generation. Kept deliberately simple: description is the field that matters.

export default async function OrgProfilePage() {
  const { workspace, membership } = await requireMembership();
  const org = await db.orgProfile.findUnique({ where: { workspaceId: workspace.id } });
  const editor = canEdit(membership.role);

  return (
    <main className="p-6 w-full">
      <Link href="/blog" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Blog
      </Link>
      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--teal-soft)", color: "var(--teal-on)" }}>
          <Building2 className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-2xl leading-tight">Organization profile</h1>
          <p className="text-xs text-[var(--mute)]">
            What this workspace&apos;s organization does. Every AI draft is grounded in this — write it well.
          </p>
        </div>
      </div>

      <form action={saveOrgProfileAction} className="card flex flex-col gap-4">
        <label className="text-sm">
          <span className="block text-xs text-[var(--mute)] mb-1">
            What they do, for whom, and what makes them different
          </span>
          <textarea
            name="description"
            rows={6}
            defaultValue={org?.description ?? ""}
            placeholder="e.g. LSI Media is a digital agency helping nonprofits grow through content-led SEO…"
            className="w-full text-sm leading-relaxed"
            disabled={!editor}
          />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Industry</span>
            <input name="industry" defaultValue={org?.industry ?? ""} className="w-full" disabled={!editor} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Primary audience</span>
            <input name="audience" defaultValue={org?.audience ?? ""} className="w-full" disabled={!editor} />
          </label>
        </div>
        {editor && <SubmitButton className="btn primary self-start">Save profile</SubmitButton>}
      </form>
    </main>
  );
}
