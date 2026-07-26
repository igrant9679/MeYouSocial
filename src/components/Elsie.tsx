"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Compass, X, ArrowRight, ArrowLeft, Check } from "lucide-react";
import { markGuideStepsDoneAction, setGuideEnabledAction, snoozeGuideAction } from "@/app/actions/guide";

/**
 * Elsie — LSI Media's in-app guide. ("L-S-I" said aloud is *el-ess-eye*.)
 *
 * Renders two things: the on/off button that lives in the top bar, and the
 * coach-mark overlay itself — a spotlight cut around the thing being explained,
 * an arrow, and a popup.
 *
 * ── Choices worth knowing ───────────────────────────────────────────────────
 * • Anchors are `data-elsie="…"` attributes, not CSS selectors. A selector like
 *   `.btn:nth-child(3)` breaks the first time someone reorders a toolbar, and
 *   breaks SILENTLY — the tour would just point at the wrong thing.
 * • The spotlight is one element with a huge `box-shadow` spread, rather than
 *   four divs forming a mask. It can't develop seams, and it animates as one.
 * • The overlay swallows clicks. A tour that lets you click through it lets you
 *   navigate away mid-step and strand the highlight; steps that want you to act
 *   carry an explicit "take me there" link instead.
 * • Steps whose anchor is missing are SKIPPED, not left pointing at nothing —
 *   a page can legitimately not render a control (no accounts, no permission).
 */

export type ElsieStep = {
  id: string;
  title: string;
  body: string;
  anchor?: string;
  route?: string;
  cta?: { label: string; href: string };
  kind: "setup" | "tour";
};

const TIP_WIDTH = 340;
const GAP = 14; // space between spotlight and popup
const PAD = 6; // spotlight padding around the target

type Placement = "top" | "bottom" | "left" | "right" | "center";
type Box = { top: number; left: number; width: number; height: number };

function findAnchor(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-elsie="${CSS.escape(key)}"]`);
}

export function Elsie({
  steps,
  enabled,
  outstanding,
  snoozed,
}: {
  /** Already filtered server-side to what's relevant and not yet done. */
  steps: ElsieStep[];
  enabled: boolean;
  /** Outstanding setup steps — badges the button. */
  outstanding: number;
  /** Dismissed earlier this session — she stays available but won't auto-open. */
  snoozed: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [index, setIndex] = useState(0);
  // "Not now" hides the overlay without switching Elsie off. Seeded from the
  // session snooze so a dismissal survives navigation — this component
  // re-mounts constantly, and local state alone reset on every page change.
  const [dismissed, setDismissed] = useState(snoozed);
  /**
   * Whether the CURRENT step was reached by the user pressing Next/Back.
   *
   * Gates navigation. Elsie used to `router.push` to a step's route whenever
   * its anchor was missing — including on auto-open, which meant opening any
   * page could yank you somewhere else entirely. Going to /ideas and landing on
   * /admin/connections is not a guide, it's a hijack. She may now only navigate
   * when you asked her to continue.
   */
  const userDriven = useRef(false);
  const [target, setTarget] = useState<Box | null>(null);
  const [placement, setPlacement] = useState<Placement>("bottom");
  const [tipPos, setTipPos] = useState<{ top: number; left: number } | null>(null);
  const [ready, setReady] = useState(false);
  const tipRef = useRef<HTMLDivElement>(null);

  const step: ElsieStep | undefined = steps[index];
  const open = enabled && !dismissed && Boolean(step);

  /** Measure the anchor and place the popup around it. */
  const reposition = useCallback(() => {
    if (!step) return;
    if (!step.anchor) {
      setTarget(null);
      setPlacement("center");
      setReady(true);
      return;
    }
    const el = findAnchor(step.anchor);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const box: Box = { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
    setTarget(box);

    const tipH = tipRef.current?.offsetHeight ?? 190;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Prefer below, then above, then the sides — whichever genuinely fits.
    let place: Placement = "bottom";
    if (box.top + box.height + GAP + tipH <= vh - 8) place = "bottom";
    else if (box.top - GAP - tipH >= 8) place = "top";
    else if (box.left + box.width + GAP + TIP_WIDTH <= vw - 8) place = "right";
    else if (box.left - GAP - TIP_WIDTH >= 8) place = "left";
    else place = "center";
    setPlacement(place);

    if (place === "center") {
      setTipPos(null);
      setReady(true);
      return;
    }
    let top: number;
    let left: number;
    if (place === "bottom" || place === "top") {
      top = place === "bottom" ? box.top + box.height + GAP : box.top - GAP - tipH;
      left = box.left + box.width / 2 - TIP_WIDTH / 2;
    } else {
      top = box.top + box.height / 2 - tipH / 2;
      left = place === "right" ? box.left + box.width + GAP : box.left - GAP - TIP_WIDTH;
    }
    // Keep it fully on screen — a popup half off the edge is worse than one
    // slightly off-centre from its target.
    left = Math.max(8, Math.min(left, vw - TIP_WIDTH - 8));
    top = Math.max(8, Math.min(top, vh - tipH - 8));
    setTipPos({ top, left });
    setReady(true);
  }, [step]);

  // Locate the current step's anchor, navigating and waiting if needed.
  useEffect(() => {
    if (!open || !step) return;
    setReady(false);
    let cancelled = false;

    if (!step.anchor) {
      reposition();
      return;
    }
    // Only ever navigate on an explicit Next/Back. On auto-open we stay put and
    // fall through: if the anchor isn't here, the step renders as a centred
    // card with its "take me there" link, which the reader chooses to follow.
    if (step.route && pathname !== step.route) {
      if (!userDriven.current) {
        setTarget(null);
        setPlacement("center");
        setReady(true);
        return;
      }
      router.push(step.route);
      // The effect re-runs when pathname changes; don't poll across the nav.
      return;
    }

    // The anchor may mount a frame or two after the route settles.
    const deadline = Date.now() + 2500;
    const tick = () => {
      if (cancelled) return;
      const el = findAnchor(step.anchor!);
      if (el) {
        // Instant, not smooth: a smooth scroll is still moving when we measure,
        // which puts the spotlight where the target *was*.
        el.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
        // Measure NOW, then correct once layout has settled. Deliberately not
        // requestAnimationFrame: browsers suspend rAF in a hidden or background
        // tab, so anyone who switched tabs mid-tour would come back to a guide
        // stuck with no popup. setTimeout still fires (throttled) when hidden.
        reposition();
        setTimeout(() => { if (!cancelled) reposition(); }, 60);
        return;
      }
      if (Date.now() > deadline) {
        if (userDriven.current) {
          // Following the tour and this control genuinely isn't here — skip on
          // rather than point at nothing.
          setIndex((i) => (i + 1 < steps.length ? i + 1 : i));
        } else {
          // Auto-opened somewhere the anchor doesn't exist. Show the step as a
          // plain card; silently advancing would race through the tour behind
          // the reader's back.
          setTarget(null);
          setPlacement("center");
          setReady(true);
        }
        return;
      }
      setTimeout(tick, 80);
    };
    tick();
    return () => { cancelled = true; };
  }, [open, step, pathname, router, reposition, steps.length]);

  // Re-measure once the popup has its real height, and on scroll/resize.
  useLayoutEffect(() => {
    if (!open || !ready) return;
    reposition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ready, index]);

  useEffect(() => {
    if (!open) return;
    const onMove = () => reposition();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, reposition]);

  const finish = useCallback(
    (completed: boolean) => {
      setDismissed(true);
      // Fire and forget: closing must feel instant, and a failed cookie write
      // only costs the reader seeing a step again.
      if (completed) {
        // Reached the end — record the lot so she doesn't start over.
        void markGuideStepsDoneAction(steps.map((s) => s.id));
      } else {
        // "Not now". Deliberately does NOT mark the current step done: you
        // dismissed it, you didn't complete it, so it should be waiting where
        // you left it. The snooze is what stops her reappearing — and it has to
        // be server-side, because this component remounts on every navigation.
        void snoozeGuideAction();
      }
    },
    [steps],
  );

  const next = useCallback(() => {
    userDriven.current = true;
    if (index + 1 >= steps.length) {
      finish(true);
      return;
    }
    void markGuideStepsDoneAction([steps[index].id]);
    setIndex((i) => i + 1);
  }, [index, steps, finish]);

  const back = useCallback(() => {
    userDriven.current = true;
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  // Esc closes; arrows step. Only while she's actually on screen.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); finish(false); }
      else if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, next, back, finish]);

  useEffect(() => {
    if (open && ready) tipRef.current?.focus();
  }, [open, ready, index]);

  return (
    <>
      {/* The top-bar switch. A form, so it works before hydration too. */}
      <form action={setGuideEnabledAction} className="shrink-0">
        <input type="hidden" name="on" value={enabled ? "0" : "1"} />
        <button
          type="submit"
          data-elsie="elsie-button"
          onClick={() => { setDismissed(false); userDriven.current = false; }}
          title={enabled ? "Turn Elsie off" : "Turn Elsie on — she'll walk you through the app"}
          aria-pressed={enabled}
          className="relative inline-flex items-center gap-1.5 h-11 px-2.5 rounded-xl text-[13px] font-semibold transition-colors hover:bg-[var(--zebra)]"
          style={enabled ? { background: "var(--accent-soft)", color: "var(--accent-on)" } : { color: "var(--mute)" }}
        >
          <Compass className="w-[19px] h-[19px]" strokeWidth={2.25} />
          <span className="hidden @md:inline">Elsie</span>
          {outstanding > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-1 rounded-full text-[10px] font-mono font-bold grid place-items-center"
              style={{ background: "var(--amber-on)", color: "#fff" }}
              title={`${outstanding} setup step${outstanding === 1 ? "" : "s"} outstanding`}
            >
              {outstanding}
            </span>
          )}
        </button>
      </form>

      {open && ready && (
        <div className="fixed inset-0 z-[100]" role="presentation">
          {/* Spotlight, or a plain scrim for anchorless steps. */}
          {target ? (
            <div
              aria-hidden
              className="absolute rounded-xl pointer-events-none transition-all duration-200 motion-reduce:transition-none"
              style={{
                top: target.top,
                left: target.left,
                width: target.width,
                height: target.height,
                boxShadow: "0 0 0 9999px rgba(10,12,16,0.62)",
                outline: "2px solid var(--accent)",
                outlineOffset: 2,
              }}
            />
          ) : (
            <div aria-hidden className="absolute inset-0" style={{ background: "rgba(10,12,16,0.62)" }} />
          )}

          {/* Click-swallowing layer, under the popup. */}
          <div className="absolute inset-0" onClick={() => finish(false)} aria-hidden />

          <div
            ref={tipRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="elsie-title"
            tabIndex={-1}
            className="absolute card shadow-2xl outline-none"
            style={
              tipPos
                ? { top: tipPos.top, left: tipPos.left, width: TIP_WIDTH, maxWidth: "calc(100vw - 16px)" }
                : { top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: TIP_WIDTH, maxWidth: "calc(100vw - 16px)" }
            }
          >
            {/* Arrow — a rotated square tucked under the popup edge. */}
            {tipPos && target && placement !== "center" && (
              <span
                aria-hidden
                className="absolute w-3 h-3 rotate-45"
                style={{
                  background: "var(--card, #fff)",
                  borderLeft: placement === "right" ? "1px solid var(--line)" : undefined,
                  borderTop: placement === "bottom" ? "1px solid var(--line)" : undefined,
                  borderRight: placement === "left" ? "1px solid var(--line)" : undefined,
                  borderBottom: placement === "top" ? "1px solid var(--line)" : undefined,
                  ...(placement === "bottom" || placement === "top"
                    ? {
                        left: Math.max(12, Math.min(target.left + target.width / 2 - tipPos.left - 6, TIP_WIDTH - 24)),
                        [placement === "bottom" ? "top" : "bottom"]: -6,
                      }
                    : {
                        top: Math.max(12, Math.min(target.top + target.height / 2 - tipPos.top - 6, (tipRef.current?.offsetHeight ?? 180) - 24)),
                        [placement === "right" ? "left" : "right"]: -6,
                      }),
                }}
              />
            )}

            <div className="flex items-start gap-2 mb-1.5">
              <span
                className="w-7 h-7 rounded-lg grid place-items-center shrink-0"
                style={{ background: "var(--accent-soft)", color: "var(--accent-on)" }}
                aria-hidden
              >
                <Compass className="w-4 h-4" strokeWidth={2.25} />
              </span>
              <h2 id="elsie-title" className="font-mono font-bold text-sm leading-snug flex-1 pt-1">
                {step!.title}
              </h2>
              <button
                type="button"
                onClick={() => finish(false)}
                className="text-[var(--mute)] hover:text-[var(--ink)] p-1 -m-1"
                aria-label="Close the guide"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[13px] text-[var(--slate)] leading-relaxed mb-3">{step!.body}</p>

            {step!.cta && (
              <a
                href={step!.cta.href}
                className="btn sm primary !inline-flex mb-3"
                onClick={() => void markGuideStepsDoneAction([step!.id])}
              >
                {step!.cta.label} <ArrowRight className="w-3.5 h-3.5" />
              </a>
            )}

            <div className="flex items-center gap-2 pt-2 border-t border-[var(--line)]">
              <span className="font-mono text-[10px] text-[var(--mute)]">
                {index + 1} / {steps.length}
                {step!.kind === "setup" && (
                  <span className="ml-1.5 px-1 py-0.5 rounded" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
                    setup
                  </span>
                )}
              </span>
              <span className="flex-1" />
              {index > 0 && (
                <button type="button" onClick={back} className="btn sm">
                  <ArrowLeft className="w-3.5 h-3.5" /> Back
                </button>
              )}
              <button type="button" onClick={next} className="btn sm primary">
                {index + 1 >= steps.length ? (<><Check className="w-3.5 h-3.5" /> Done</>) : (<>Next <ArrowRight className="w-3.5 h-3.5" /></>)}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
