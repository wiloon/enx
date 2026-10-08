import { useId } from 'react'

// The Catglish mark: a "C" with cat ears and an amber eye on a teal tile.
// Same geometry as the Chrome Web Store icon and src/app/icon.svg, drawn
// inline so it stays sharp at any size.
export default function LogoMark({ className }: { className?: string }) {
  const gradientId = useId()
  return (
    <svg
      aria-hidden
      data-testid="logo-mark"
      viewBox="0 0 96 96"
      className={className}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#009ca5" />
          <stop offset="1" stopColor="#006871" />
        </linearGradient>
      </defs>
      <rect width="96" height="96" rx="22" fill={`url(#${gradientId})`} />
      <path
        d="M41.1 35.3 23.6 14l1.3 28.8zM54.9 35.3 72.4 14l-1.3 28.8z"
        fill="#fff"
      />
      <path
        d="M66.9 38.1A24.7 24.7 0 1 0 66.9 69.9"
        fill="none"
        stroke="#fff"
        strokeWidth="13.1"
        strokeLinecap="round"
      />
      <circle cx="55.5" cy="54" r="5" fill="#ffc83d" />
    </svg>
  )
}
