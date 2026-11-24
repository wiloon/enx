'use client'

import { useEffect, useState, type FocusEvent } from 'react'
import { SITE } from '@/lib/site'
import { WORD_LOOKUP_ILLUSTRATION } from './WordLookupIllustration'

const ADVANCE_MS = 5000

// Chrome's install order (#1101). The Proceed with caution slide goes when
// #560 closes, together with ENHANCED_PROTECTION_NOTE and its SVG.
const SLIDES = [
  {
    src: '/onboarding/install-store-listing.svg',
    alt: `The ${SITE.name} page in the Chrome Web Store: click the blue Add to Chrome button at the top right`,
    caption: 'On the store page, click the blue Add to Chrome button.',
  },
  {
    src: '/onboarding/install-proceed-with-caution.svg',
    alt: 'The Proceed with caution dialog: click Continue to install',
    caption:
      'If Chrome says “Proceed with caution”, click Continue to install.',
  },
  {
    src: '/onboarding/install-add-extension.svg',
    alt: `The Add “${SITE.name}”? dialog: click Add extension`,
    caption: `Click Add extension, then come back to this page.`,
  },
  WORD_LOOKUP_ILLUSTRATION,
]

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

// How to install, beside the steps while the extension is missing (#1101):
// many first-time users never notice Add to Chrome on the store page.
export default function InstallWalkthrough() {
  const [current, setCurrent] = useState(0)
  const [chosen, setChosen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [reducedMotion] = useState(prefersReducedMotion)

  const running = !chosen && !hovered && !focused && !reducedMotion
  useEffect(() => {
    if (!running) return
    const timer = setInterval(
      () => setCurrent((i) => (i + 1) % SLIDES.length),
      ADVANCE_MS
    )
    return () => clearInterval(timer)
  }, [running])

  const leaveFocus = (e: FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null))
      setFocused(false)
  }

  const slide = SLIDES[current]
  return (
    <section
      aria-label="How to install"
      aria-roledescription="carousel"
      className="w-full max-w-xl space-y-3"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={leaveFocus}
    >
      <figure className="space-y-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- static
            illustrations from public/, nothing to optimize */}
        <img
          src={slide.src}
          alt={slide.alt}
          width={480}
          height={360}
          className="h-auto w-full"
        />
        <figcaption className="text-sm text-muted-foreground">
          {slide.caption}
        </figcaption>
      </figure>
      <div role="group" aria-label="Slides" className="flex gap-2">
        {SLIDES.map((s, i) => (
          <button
            key={s.src}
            type="button"
            aria-label={`Show slide ${i + 1}`}
            aria-current={i === current ? 'true' : undefined}
            onClick={() => {
              setCurrent(i)
              setChosen(true)
            }}
            className={`flex size-7 items-center justify-center rounded-full border text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:opacity-80 ${
              i === current
                ? 'border-brand bg-brand text-brand-foreground'
                : 'border-input text-muted-foreground hover:border-brand hover:text-foreground'
            }`}
          >
            {i + 1}
          </button>
        ))}
      </div>
    </section>
  )
}
