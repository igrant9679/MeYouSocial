import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { ArrowLeft, Download, FileText, Tv, Sparkles } from "lucide-react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { generatePromoAction } from "@/app/actions/publish";
import { generateChapterMarkersAction } from "@/app/actions/growth";
import { CopyButton } from "@/components/CopyButton";

// MU (publish surface) — Export, Teleprompter, Promo, Titles/Tags.

const PROMO_GROUPS = [
  {
    label: "Titles & metadata",
    items: [
      { kind: "titles", title: "Title variations", color: "var(--brand)" },
      { kind: "hooks", title: "Hook variations", color: "var(--amber)" },
      { kind: "description", title: "Video description", color: "var(--blue)" },
      { kind: "tags", title: "Tags", color: "var(--green)" },
    ],
  },
  {
    label: "Promo / cross-post",
    items: [
      { kind: "social_twitter", title: "Twitter / X thread", color: "var(--cyan)" },
      { kind: "social_linkedin", title: "LinkedIn post", color: "var(--indigo)" },
      { kind: "social_instagram", title: "Instagram caption", color: "var(--pink)" },
      { kind: "newsletter", title: "Newsletter section", color: "var(--purple)" },
      { kind: "blog", title: "Blog adaptation", color: "var(--violet)" },
      { kind: "shotlist", title: "Shot list / B-roll", color: "var(--rose)" },
    ],
  },
];

export default async function PublishPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await requireMembership();
  const script = await db.script.findFirst({
    where: { id, channel: { workspaceId: workspace.id } },
    include: { channel: true },
  });
  if (!script) notFound();

  const publish = readJson<{ publish?: Record<string, string> }>(script.outline ?? null, {}).publish ?? {};

  return (
    <div>
      <Link href={`/scripts/${id}`} className="text-xs font-mono text-[var(--mute)] hover:text-[var(--accent)] flex items-center gap-1 mb-3"><ArrowLeft className="w-3 h-3" /> Back to script</Link>

      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--green-soft)", color: "var(--green)" }}>
          <Sparkles className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-2xl leading-tight">Publish & promote</h1>
          <p className="text-xs text-[var(--mute)]">{script.title}</p>
        </div>
      </div>

      {/* Export & Teleprompter row */}
      <section className="card mb-5">
        <h2 className="font-mono font-bold text-sm mb-3 flex items-center gap-2"><Download className="w-4 h-4" style={{ color: "var(--green)" }} /> Export</h2>
        <div className="flex flex-wrap gap-2">
          <CopyButton text={script.body ?? ""} label="Copy to clipboard" />
          <a href={`/api/scripts/${id}/export?format=docx`} className="btn flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Download .docx</a>
          <a href={`/api/scripts/${id}/export?format=pdf`} className="btn flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Download .pdf</a>
          <Link href={`/teleprompter/${id}`} className="btn flex items-center gap-1.5"><Tv className="w-3.5 h-3.5" /> Teleprompter</Link>
        </div>
      </section>

      {/* Chapter markers */}
      <section className="card mb-5">
        <h2 className="font-mono font-bold text-sm mb-3 flex items-center gap-2">YouTube chapter markers</h2>
        <div className="flex items-center gap-2 mb-2">
          {publish.chapters && <CopyButton text={publish.chapters} />}
          <form action={generateChapterMarkersAction}>
            <input type="hidden" name="scriptId" value={id} />
            <SubmitButton className="btn primary sm">{publish.chapters ? "Regenerate chapters" : "Generate chapters"}</SubmitButton>
          </form>
        </div>
        {publish.chapters && (
          <pre className="bg-[var(--zebra)] rounded-md p-3 text-xs whitespace-pre-wrap font-mono max-h-64 overflow-auto">{publish.chapters}</pre>
        )}
      </section>

      {/* Promo generators */}
      {PROMO_GROUPS.map((grp) => (
        <section key={grp.label} className="card mb-5">
          <h2 className="font-mono font-bold text-sm mb-3">{grp.label}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {grp.items.map((it) => (
              <PromoCard
                key={it.kind}
                scriptId={id}
                kind={it.kind}
                title={it.title}
                color={it.color}
                value={publish[it.kind]}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function PromoCard({ scriptId, kind, title, color, value }: { scriptId: string; kind: string; title: string; color: string; value?: string }) {
  return (
    <div className="border border-[var(--line)] rounded-xl p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full" style={{ background: color }} />
        <span className="font-semibold text-sm">{title}</span>
        <span className="flex-1" />
        {value && <CopyButton text={value} />}
        <form action={generatePromoAction}>
          <input type="hidden" name="scriptId" value={scriptId} />
          <input type="hidden" name="kind" value={kind} />
          <SubmitButton className="btn primary sm">{value ? "Regenerate" : "Generate"}</SubmitButton>
        </form>
      </div>
      {value && (
        <div className="bg-[var(--zebra)] rounded-md p-3 text-xs whitespace-pre-wrap font-mono max-h-64 overflow-auto">{value}</div>
      )}
    </div>
  );
}
