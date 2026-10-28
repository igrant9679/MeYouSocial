import { formatNum, outlierBand } from "@/lib/intel";

/**
 * An outlier ratio with what it rests on (E-IDE-11): the multiple, its band
 * when asked, and the views it was measured from where the row doesn't already
 * show them. No score reads "not scored" — the Intel list printed a missing
 * score as "0.0x" and four other places as a bare "x".
 */
export function OutlierChip({
  score,
  views,
  label = false,
  size = "sm",
  title,
}: {
  score: number | null | undefined;
  views?: number | bigint | null;
  /** Add the band's word ("strong", "exceptional"). */
  label?: boolean;
  size?: "xs" | "sm";
  title?: string;
}) {
  const band = outlierBand(score);
  const text = score == null
    ? "not scored"
    : `${score.toFixed(1)}×${label ? ` ${band.label}` : ""}${views != null ? ` · ${formatNum(views)} views` : ""}`;
  return (
    <span
      className={`font-mono font-bold whitespace-nowrap shrink-0 ${size === "xs" ? "text-[10px] px-1.5 py-0.5 rounded-full" : "text-[11px] px-2 py-1 rounded-md"}`}
      style={{ background: band.soft, color: band.color }}
      title={title ?? (score == null ? "Not scored — under 1,000 views, or too few videos of this format on the channel to compare" : `${band.label}: views ÷ the channel's average for this format`)}
    >
      {text}
    </span>
  );
}
