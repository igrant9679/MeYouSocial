// Remounts on every navigation inside the app shell, so the entrance animation
// plays per route change. 180ms, transform+opacity only, disabled under
// prefers-reduced-motion (globals.css).
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-enter min-h-full">{children}</div>;
}
