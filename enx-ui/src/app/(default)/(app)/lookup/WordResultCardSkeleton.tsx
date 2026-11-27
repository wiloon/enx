export default function WordResultCardSkeleton() {
  return (
    <div
      data-testid="word-result-skeleton"
      className="animate-pulse space-y-4 rounded-xl border p-6"
      aria-hidden="true"
    >
      <div className="h-8 w-40 rounded bg-muted" />
      <div className="h-4 w-24 rounded bg-muted" />
      <div className="h-6 w-full rounded bg-muted" />
      <div className="h-4 w-1/2 rounded bg-muted" />
    </div>
  )
}
