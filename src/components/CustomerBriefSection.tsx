import Link from "next/link";
import type { Role } from "@prisma/client";
import { ExternalLink, UserRoundSearch } from "lucide-react";
import type { BriefBasis, BriefLine, CustomerBrief } from "@/lib/assistant/customer-brief";
import { canFollow, whoCanFix } from "@/lib/role-links";

/**
 * Brand → "What Elsie knows about your customers" (2026-11-17).
 *
 * Shows a person exactly what Elsie works from when she fits advice to the
 * customer: the same object her prompt and her customer_profile tool read
 * (lib/assistant/customer-brief.ts), line for line, with what each rests on.
 * Read-only on purpose — every line is edited where it lives, and the link
 * beside it goes there. A server component; no client JS.
 */

const CHIP: Record<BriefBasis, { label: string; title: string; bg: string; fg: string }> = {
  described: { label: "Described", title: "The team's own words — not a measurement", bg: "var(--indigo-soft)", fg: "var(--indigo-on)" },
  drafted: { label: "AI draft", title: "Written by AI when the channel was set up, and not edited by a person since — unconfirmed", bg: "var(--amber-soft)", fg: "var(--amber-on)" },
  measured: { label: "Measured", title: "Counted from stored results", bg: "var(--teal-soft)", fg: "var(--teal-on)" },
};

function Row({ line, role }: { line: BriefLine; role: Role }) {
  const chip = CHIP[line.basis];
  return (
    <li className="flex items-start gap-2 text-xs" data-brief-line={line.basis} data-brief-always={line.always ? "yes" : "no"}>
      <span className="shrink-0 font-mono text-micro uppercase px-1.5 py-0.5 rounded-full mt-0.5" style={{ background: chip.bg, color: chip.fg }} title={chip.title}>{chip.label}</span>
      <span className="flex-1 min-w-0 break-words">
        {line.text}
        {/* Non-breaking hyphens: a date must not wrap in the middle on a phone. */}
        <span className="text-2xs text-[var(--mute)]"> · {line.when.replace(/(\d)-(?=\d)/g, "$1‑")}</span>
      </span>
      {canFollow(line.href, role) && (
        <Link href={line.href} className="shrink-0 text-2xs underline text-[var(--mute)] inline-flex items-center gap-0.5 mt-0.5" aria-label={`Open where this comes from: ${line.href}`}>
          Open <ExternalLink className="w-3 h-3" />
        </Link>
      )}
    </li>
  );
}

export function CustomerBriefSection({ brief, role, channelName }: { brief: CustomerBrief; role: Role; channelName: string | null }) {
  const total = brief.sections.reduce((a, s) => a + s.lines.length, 0);
  return (
    <>
      <span id="customers" className="block scroll-mt-4" aria-hidden />
      <div className="flex items-baseline gap-2 mb-2 flex-wrap">
        <span className="translate-y-0.5"><UserRoundSearch className="w-4 h-4" style={{ color: "var(--teal-on)" }} /></span>
        <h2 className="font-mono font-bold text-sm">What Elsie knows about your customers</h2>
        <span className="text-2xs text-[var(--mute)]">
          Read from this workspace&apos;s own records each time the page opens — none of it is written by AI. It is what she goes on when she fits advice to your audience.
        </span>
      </div>
      <div className="card mb-6 flex flex-col gap-4" data-customer-brief>
        {total === 0 && (
          <p className="text-xs m-0">
            Nothing is on record about your customers yet, so Elsie says so when asked rather than guessing. Each part below names what is missing and where to add it.
          </p>
        )}
        {brief.sections.map((s) => {
          const always = s.lines.filter((l) => l.always);
          const onRequest = s.lines.filter((l) => !l.always);
          return (
            <section key={s.key} data-brief-section={s.key}>
              <h3 className="font-mono text-micro uppercase tracking-wider text-[var(--mute)] mb-1.5">{s.title}</h3>
              {always.length > 0 && <ul className="flex flex-col gap-1.5 m-0 p-0 list-none">{always.map((l, i) => <Row key={i} line={l} role={role} />)}</ul>}
              {onRequest.length > 0 && (
                <>
                  <p className="text-2xs text-[var(--mute)] mt-2 mb-1.5 pt-2 border-t border-[var(--line)]">Read when a question is about the customer</p>
                  <ul className="flex flex-col gap-1.5 m-0 p-0 list-none">{onRequest.map((l, i) => <Row key={i} line={l} role={role} />)}</ul>
                </>
              )}
              {s.missing.length > 0 && (
                <ul className={`flex flex-col gap-1 m-0 p-0 list-none ${s.lines.length ? "mt-2" : ""}`}>
                  {s.missing.map((m, i) => (
                    <li key={i} className="text-xs text-[var(--mute)] flex items-start gap-2" data-brief-missing>
                      <span className="shrink-0 font-mono text-micro uppercase px-1.5 py-0.5 rounded-full border border-[var(--line-2)] mt-0.5">Not known</span>
                      <span className="flex-1 min-w-0">
                        {m.text}{" "}
                        {canFollow(m.href, role)
                          ? <Link href={m.href} className="underline">Open</Link>
                          : <span>{whoCanFix(m.href)}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
        <p className="text-2xs text-[var(--mute)] m-0 pt-3 border-t border-[var(--line)]">
          The first lines of each part go with every message to Elsie; she reads the rest when a question is about the customer. Results under those first lines can be up to five minutes behind this page.
          {" "}Comments, messages and reviews are counted, never copied here — read them in Distribute → Engage.
          {" "}{channelName ? <>The channel audience shown is <b>{channelName}</b>&apos;s — your active channel.</> : "No YouTube channel is set up here, so no channel audience is shown."}
        </p>
      </div>
    </>
  );
}
