/**
 * The MeYouSocial mark — a folded broadsheet forming an M. Ink badge, white
 * left fold, coral right fold (the brand moment). Server-safe plain SVG.
 *
 * Geometry is authored on a 52×52 grid; pass `size` for the rendered box.
 */
export function BrandLogo({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 52 52"
      role="img"
      aria-label="MeYouSocial"
      className={className}
    >
      <rect width="52" height="52" rx="11" fill="#15181D" />
      <path d="M9 41 V14 L22.5 32 L27 25.5 V41 Z" fill="#FFFFFF" />
      <path d="M27 25.5 L31.5 32 L43 14 V41 H34.5 V28 Z" fill="#E5482F" />
    </svg>
  );
}
