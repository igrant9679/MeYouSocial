/** Shared shimmer skeleton for route loading states. */
export function RouteSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="p-6 w-full max-w-5xl mx-auto" aria-busy="true" aria-label="Loading">
      <div className="shimmer h-8 w-56 mb-2" />
      <div className="shimmer h-3.5 w-80 mb-6" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card">
            <div className="shimmer h-3 w-20 mb-2" />
            <div className="shimmer h-7 w-14" />
          </div>
        ))}
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="card mb-3">
          <div className="shimmer h-3.5 w-40 mb-3" />
          <div className="shimmer h-3 w-full mb-2" />
          <div className="shimmer h-3 w-4/5 mb-2" />
          <div className="shimmer h-3 w-3/5" />
        </div>
      ))}
    </div>
  );
}
