import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * The one empty state (audit B6 / recommendation D4).
 *
 * ⚠ Before this there were three dialects and no action in any of them: a
 * muted sentence with nowhere to go, the literal word "Empty" in twelve kanban
 * columns, and a local `Empty` helper in ReportBlocks that could only take
 * text. Reports showed ten tiles all saying "no data" with nothing to press.
 * Every blank panel now answers the same two questions in the same shape: why
 * is this empty, and what is the ONE thing to do next.
 *
 * It inherits the app's truthfulness rule. A blank is not a zero, so `line`
 * says which of the two this is; and it never offers an action the viewer
 * cannot take — pass `action={null}` with a `note` naming who can (an admin,
 * or the owner outside this app, as with granting Google access).
 *
 * ⚠ `.card` and `.btn` are unlayered in globals.css and beat Tailwind
 * utilities, so the padding override is `!`-marked.
 *
 * Not "use client": it is a server component so a page can hand it a server
 * action directly. SubmitButton is the only client boundary and takes plain
 * props.
 */

export type EmptyAction =
  | { label: string; href: string }
  | {
      label: string;
      /** A server action. Named `run` so it can't be confused with <form action>. */
      run: (formData: FormData) => void | Promise<void>;
      pendingText?: string;
      fields?: Record<string, string>;
    };

export function EmptyState({
  line,
  action = null,
  note,
  tone = "quiet",
  icon,
  variant = "card",
}: {
  /** One sentence. Says WHY it is empty, not just that it is. */
  line: React.ReactNode;
  /** The ONE next step, or null when the viewer genuinely cannot act. */
  action?: EmptyAction | null;
  /** Optional second line: who can act, or what a dash means. Never a third idea. */
  note?: React.ReactNode;
  /** quiet = nothing is wrong · attention = something is missing · clear = done, nothing waiting. */
  tone?: "quiet" | "attention" | "clear";
  icon?: React.ReactNode;
  /** "inline" drops the card chrome, for use inside a .card that already exists. */
  variant?: "card" | "inline";
}) {
  const framed = variant === "card";
  const style =
    tone === "attention"
      ? { background: "var(--amber-soft)", borderColor: "var(--amber)" }
      : tone === "clear"
        ? { borderColor: "var(--green)" }
        : undefined;

  return (
    <div
      className={framed ? "card flex flex-wrap items-center gap-3 !py-5" : "flex flex-wrap items-center gap-3 py-3"}
      style={framed ? style : undefined}
    >
      {icon && <span className="shrink-0 grid place-items-center" aria-hidden>{icon}</span>}
      <div className="flex-1 min-w-48">
        <p className="text-sm m-0" style={tone === "attention" && framed ? { color: "var(--amber-on)" } : undefined}>
          {line}
        </p>
        {note && <p className="text-[11px] text-[var(--mute)] mt-1 mb-0">{note}</p>}
      </div>
      {action &&
        ("href" in action ? (
          <Link href={action.href} className="btn primary shrink-0">{action.label}</Link>
        ) : (
          <form action={action.run} className="shrink-0">
            {Object.entries(action.fields ?? {}).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <SubmitButton className="btn primary" pendingText={action.pendingText}>{action.label}</SubmitButton>
          </form>
        ))}
    </div>
  );
}
