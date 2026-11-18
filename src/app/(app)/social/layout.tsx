/**
 * Social shell. The sticky Social tab bar that used to live here is gone
 * (One-Loop step 4b): Compose, Calendar, Engage and — since 2026-11-18 —
 * Approvals are tabs of Distribute, Performance of Measure — and the persistent
 * StageStrip in the app shell shows those. The full-bleed wrapper stays because
 * every /social page pads itself.
 */
export default function SocialLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-6 -mb-6 min-h-full flex flex-col">
      <div className="flex-1">{children}</div>
    </div>
  );
}
