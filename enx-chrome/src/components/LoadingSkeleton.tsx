import { useEffect, useState } from 'react'

// Placeholder for content whose shape is known up front (a definition, a
// translation): gray bars that pulse. It replaces the spinning ⏳, whose
// rotated box poked out of the word card's scrolling body and flashed a
// scrollbar. The pulse stays on even under reduced motion, by design: still
// bars read as broken, not as loading.
//
// The bars keep their space from the first render but stay hidden for
// `delayMs`, so a fast answer (a cache hit) never flashes them and the card
// doesn't change height when they appear. The label is read out at once.
//
// The bars are a translucent tint of the text color, not bg-muted: the side
// panel's sentence entry is bg-muted itself, and bars of the same gray
// vanished into it.
export const SKELETON_DELAY_MS = 150

interface LoadingSkeletonProps {
  // What is loading, for screen readers ("Loading translation").
  label: string
  // One Tailwind width class per bar.
  lines?: string[]
  testId?: string
  delayMs?: number
}

export default function LoadingSkeleton({
  label,
  lines = ['w-3/4', 'w-1/2'],
  testId,
  delayMs = SKELETON_DELAY_MS,
}: LoadingSkeletonProps) {
  const [shown, setShown] = useState(delayMs <= 0)

  useEffect(() => {
    if (delayMs <= 0) return
    const timer = setTimeout(() => setShown(true), delayMs)
    return () => clearTimeout(timer)
  }, [delayMs])

  return (
    <div role="status" data-testid={testId}>
      <span className="sr-only">{label}</span>
      <div
        aria-hidden="true"
        data-testid="loading-skeleton-bars"
        className={`space-y-2 animate-pulse ${shown ? '' : 'invisible'}`}
      >
        {lines.map((width, i) => (
          <div key={i} className={`h-4 rounded-sm bg-foreground/10 ${width}`} />
        ))}
      </div>
    </div>
  )
}
