export function StepHeader({ step, total, title, subtitle }: { step: number; total: number; title: string; subtitle?: string }) {
  return (
    <div className="mb-2">
      <div className="flex items-center gap-1.5 mb-3">
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className="h-1.5 flex-1 rounded-full"
            style={{ background: i < step ? "var(--accent)" : "var(--line-2)" }}
          />
        ))}
      </div>
      <div className="text-xs font-mono uppercase tracking-wider text-[var(--mute)]">Step {step} of {total}</div>
      <h1 className="font-mono text-2xl font-bold">{title}</h1>
      {subtitle && <p className="text-sm text-[var(--mute)] mt-1">{subtitle}</p>}
    </div>
  );
}
