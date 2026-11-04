import Link from "next/link";
import { Clapperboard } from "lucide-react";
import { db } from "@/lib/db";
import { SubmitButton } from "@/components/SubmitButton";
import { extractShotList, SHOT_SOURCE, shotSection, type ShotKind } from "@/lib/shot-list";
import { syncShotListAction } from "@/app/actions/shot-list";

/**
 * The script studio's Shots tab (E-VID-09): what the script asks to be filmed,
 * section by section, read from the writer's [B-roll: …] / [Shot: …] markers,
 * and whether each is in Assets yet (and filmed — a file attached).
 */

const KIND_WORD: Record<ShotKind, string> = { broll: "B-roll", shot: "Shot", graphic: "Graphic" };

export async function ShotList({ workspaceId, scriptId, body, editor }: { workspaceId: string; scriptId: string; body: string; editor: boolean }) {
  const shots = extractShotList(body);
  const [assets, project] = await Promise.all([
    db.asset.findMany({ where: { workspaceId, source: SHOT_SOURCE, tags: { contains: `"script:${scriptId}"` } }, select: { id: true, name: true, tags: true, url: true, uploadKey: true } }),
    db.contentProject.findFirst({ where: { scriptId, channel: { workspaceId } }, select: { id: true, title: true, status: true } }),
  ]);
  const key = (section: string, name: string) => `${section.toLowerCase()}|${name.toLowerCase()}`;
  const inAssets = new Map(assets.map((a) => [key(shotSection(a.tags), a.name), a]));
  const missing = shots.filter((s) => !inAssets.has(key(s.section, s.description))).length;
  const sections = [...new Set(shots.map((s) => s.section))];

  return (
    <div className="flex flex-col gap-4" data-shot-list="">
      <div className="card">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <h3 className="font-mono font-bold text-[15px] flex items-center gap-2 m-0"><Clapperboard className="w-4 h-4" style={{ color: "var(--accent)" }} /> Shot list</h3>
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--panel)", color: "var(--mute)" }}>{shots.length} marked</span>
          <span className="flex-1" />
          {editor && shots.length > 0 && (
            <form action={syncShotListAction}>
              <input type="hidden" name="scriptId" value={scriptId} />
              <SubmitButton className="btn sm primary" pendingText="Adding…" disabled={missing === 0}>
                {missing === 0 ? "All in Assets" : assets.length ? `Add ${missing} new to Assets` : `Put ${missing} in Assets`}
              </SubmitButton>
            </form>
          )}
        </div>
        <p className="text-xs text-[var(--mute)] mt-0">
          Read from the script&apos;s own markers — <code className="font-code">[B-roll: …]</code>, <code className="font-code">[Shot: …]</code>,{" "}
          <code className="font-code">[Cutaway: …]</code>, <code className="font-code">[Insert: …]</code>, <code className="font-code">[Graphic: …]</code> —
          under the heading they sit in. Nothing is invented: a section with no marker asks for nothing.{" "}
          {project ? (
            <>In Assets they&apos;re linked to the project <b>{project.title}</b>, so the <Link href="/production/film-queue" className="underline">Film Queue</Link> lists them while it&apos;s in Recording — and moving it to Recording adds any new ones by itself.</>
          ) : (
            <>Track this script in production to see them in the Film Queue.</>
          )}
        </p>
        {shots.length === 0 ? (
          <p className="text-sm text-[var(--mute)] m-0">No shots marked yet. Write <code className="font-code">[B-roll: the shop front at dawn]</code> where a shot belongs.</p>
        ) : (
          <div className="flex flex-col gap-3 mt-3">
            {sections.map((sec) => (
              <section key={sec}>
                <h4 className="text-[11px] font-mono uppercase tracking-wider text-[var(--mute)] m-0 mb-1">{sec}</h4>
                <ul className="m-0 p-0 list-none flex flex-col gap-1">
                  {shots.filter((s) => s.section === sec).map((s) => {
                    const a = inAssets.get(key(s.section, s.description));
                    const filmed = !!(a?.url || a?.uploadKey);
                    return (
                      <li key={`${sec}-${s.description}`} className="flex items-center gap-2 text-sm" data-shot={s.kind}>
                        <span className="font-mono text-[10px] px-1.5 rounded-full flex-shrink-0" style={{ background: "var(--panel)", color: "var(--mute)" }}>{KIND_WORD[s.kind]}</span>
                        <span className="flex-1 min-w-0">{s.description}</span>
                        <span className="font-mono text-[10px] flex-shrink-0" style={{ color: filmed ? "var(--green-on)" : a ? "var(--blue-on)" : "var(--mute)" }} data-shot-state={filmed ? "filmed" : a ? "in-assets" : "new"}>
                          {filmed ? "filmed" : a ? "in Assets" : "not in Assets yet"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
