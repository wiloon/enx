import { useId } from 'react'

/**
 * The Catglish product logo, the same artwork as `icons/icon.svg` (the
 * toolbar icon). Inline so it scales crisply and needs no asset loader; the
 * gradient id comes from useId so two logos on one page don't share a
 * <linearGradient>. Decorative: it always sits next to the product name.
 */
export default function CatglishLogo({ className }: { className?: string }) {
  const gradientId = useId()
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 96 96"
      className={className}
      aria-hidden="true"
      data-testid="catglish-logo"
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
