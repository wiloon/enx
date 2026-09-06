interface IconProps {
  className?: string
}

/**
 * "Translate the sentence in the right side panel": a browser window with a
 * filled right-hand panel and an arrow pointing into it. Custom SVG because
 * Heroicons has no side-panel glyph -- the built-in language / rectangle icons
 * don't convey "opens on the right".
 */
export default function SidePanelTranslateIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* right side panel, filled */}
      <path
        d="M15 5h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-4z"
        fill="currentColor"
        stroke="none"
        opacity={0.18}
      />
      {/* browser window frame */}
      <rect x="3" y="5" width="18" height="14" rx="2" />
      {/* panel divider */}
      <line x1="15" y1="5" x2="15" y2="19" />
      {/* arrow pointing right into the panel */}
      <path d="M6.5 12h5.5" />
      <path d="M9.75 9.25 12.5 12l-2.75 2.75" />
    </svg>
  )
}
