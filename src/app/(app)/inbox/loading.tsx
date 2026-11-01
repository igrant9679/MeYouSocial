/** The Inbox's loading state (E-SHL-14): its own shape — a sentence, then the cards that need someone. */
export default function Loading() {
  return (
    <div className="w-full" aria-busy="true" aria-label="Loading the Inbox">
      <div className="shimmer h-7 w-48 mb-2" />
      <div className="shimmer h-3.5 w-96 max-w-full mb-6" />
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="card mb-3 flex items-start gap-3">
          <div className="shimmer h-8 w-8 rounded-lg shrink-0" />
          <div className="flex-1">
            <div className="shimmer h-3.5 w-64 max-w-full mb-2" />
            <div className="shimmer h-3 w-full mb-1.5" />
            <div className="shimmer h-3 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
