/**
 * A YouTube channel's face: the profile picture when we have one, the old
 * initials tile otherwise — one component so every competitor/Intel surface
 * matches (owner's ask, 2026-08-26: "youtube profile pictures for the
 * competitor search results"). Server-safe, plain <img>: avatars live on
 * yt3.ggpht.com, which next/image would need remotePatterns for.
 */
export function ChannelAvatar({
  name,
  url,
  size = 40,
}: {
  name: string | null | undefined;
  url?: string | null;
  size?: number;
}) {
  if (url && /^https:\/\//i.test(url)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        className="rounded-xl object-cover shrink-0 border border-[var(--line)]"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="rounded-xl text-white grid place-items-center font-mono font-bold shrink-0"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(135deg,#6D28D9,#4F46E5)",
        fontSize: size >= 56 ? 20 : size >= 44 ? 16 : 13,
      }}
    >
      {(name ?? "??").slice(0, 2).toUpperCase()}
    </span>
  );
}
