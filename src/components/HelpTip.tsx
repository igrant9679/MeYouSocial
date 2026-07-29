import type { ReactNode } from "react";

/**
 * Hover/focus help — the "what does this actually do?" bubble.
 *
 * ── Why this is CSS-only, and has no "use client" ───────────────────────────
 * These belong on dozens of surfaces across the app, most of which are server
 * components. A JS tooltip (state + positioning effect) would either force
 * those surfaces to become client components or need a client island per tip.
 * Pure CSS — `group-hover` plus `group-focus-within` — costs nothing at
 * runtime, ships no JS, and drops into a server component unchanged.
 *
 * ── Accessibility ───────────────────────────────────────────────────────────
 * The trigger is a real <button> so it's keyboard-reachable, and the help text
 * lives in its `aria-label`, so a screen reader announces it on focus. The
 * visible bubble is therefore `aria-hidden` — it's a duplicate for sighted
 * users, and announcing it twice is worse than not announcing it. Focus shows
 * the bubble as well as hover, so keyboard users see the same thing.
 *
 * ⚠ `type="button"` is not optional. Most of these sit inside forms, and a
 * bare <button> in a form defaults to type="submit" — a help icon that submits
 * the composer would be a genuinely bad bug.
 *
 * ⚠ Never place one inside an <a>. Nesting a button in an anchor is invalid
 * HTML and the anchor swallows the interaction (same rule as DeleteButton).
 *
 * ── Touch devices ───────────────────────────────────────────────────────────
 * Tailwind wraps `hover:` variants in `@media (hover: hover)`, so the hover
 * rule deliberately does NOT apply on a touchscreen — which is right, or a tap
 * would leave a tooltip stuck open with nothing to dismiss it. `focus-within`
 * carries that case instead: tapping the ⓘ focuses the button and shows the
 * bubble. <WithTip> around a LINK has no touch affordance for the same reason
 * (the tap navigates) — that's fine for the nav rail, where the mobile drawer
 * shows full labels anyway, but don't rely on WithTip to explain something a
 * touch user can't otherwise discover.
 */

type Side = "top" | "bottom" | "left" | "right";

const SIDE_CLASS: Record<Side, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
  left: "right-full top-1/2 -translate-y-1/2 mr-2",
  right: "left-full top-1/2 -translate-y-1/2 ml-2",
};

/** Shared bubble. Inverted against the page so it reads as an overlay, not a
 *  panel — `--ink`/`--bg` swap automatically in dark mode. */
function Bubble({ children, side, wide }: { children: ReactNode; side: Side; wide?: boolean }) {
  return (
    <span
      aria-hidden="true"
      role="presentation"
      className={
        "pointer-events-none absolute z-50 hidden group-hover:block group-focus-within:block " +
        SIDE_CLASS[side] +
        " " +
        (wide ? "w-72" : "w-56") +
        " rounded-lg px-3 py-2 text-[12px] leading-[1.5] font-normal normal-case tracking-normal text-left shadow-lg"
      }
      style={{ background: "var(--ink)", color: "var(--bg)" }}
    >
      {children}
    </span>
  );
}

/**
 * A small ⓘ next to a label. Use when the surface has somewhere to put it.
 *
 *   <span className="flex items-center gap-1">Outlier <HelpTip text="…" /></span>
 */
export function HelpTip({
  text,
  side = "top",
  wide,
  className,
}: {
  text: string;
  side?: Side;
  wide?: boolean;
  className?: string;
}) {
  return (
    <span className={"group relative inline-flex align-middle " + (className ?? "")}>
      <button
        type="button"
        aria-label={text}
        className="inline-flex items-center justify-center w-[15px] h-[15px] rounded-full border text-[10px] font-bold leading-none cursor-help select-none"
        style={{ borderColor: "var(--line-2)", color: "var(--mute)" }}
      >
        ?
      </button>
      <Bubble side={side} wide={wide}>
        {text}
      </Bubble>
    </span>
  );
}

/**
 * Wrap an existing control so hovering THE CONTROL ITSELF explains it — no
 * extra icon. Use where adding a ⓘ would clutter (nav rows, toolbar buttons).
 *
 *   <WithTip text="…"><button className="btn">Post now</button></WithTip>
 *
 * The wrapper is `inline-flex` so it doesn't disturb the child's layout; pass
 * `block` for children that need full width.
 */
export function WithTip({
  text,
  children,
  side = "top",
  wide,
  block,
  className,
}: {
  text: string;
  children: ReactNode;
  side?: Side;
  wide?: boolean;
  block?: boolean;
  className?: string;
}) {
  return (
    <span
      className={
        "group relative " + (block ? "block" : "inline-flex") + " " + (className ?? "")
      }
// A title would double up with the bubble and fire the OS tooltip on a delay,
// so the text is exposed to assistive tech on the child's own label instead.
    >
      {children}
      <Bubble side={side} wide={wide}>
        {text}
      </Bubble>
    </span>
  );
}
