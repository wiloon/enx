'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  NAVIGATION_PROGRESS_BACKSTOP_MS,
  NAVIGATION_PROGRESS_SHOW_DELAY_MS,
  shouldStartNavigationProgress,
} from '@/lib/navigationProgress'

function clearTimer(ref: { current: ReturnType<typeof setTimeout> | null }) {
  if (ref.current !== null) {
    clearTimeout(ref.current)
    ref.current = null
  }
}

// Site-wide pending-navigation bar. One capture-phase listener covers every
// internal link; completion is the first pathname/search change after start.
export default function NavigationProgressBar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const search = searchParams.toString()
  const [visible, setVisible] = useState(false)

  const pendingRef = useRef(false)
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const backstopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Complete on the first route change after pending started.
  useEffect(() => {
    if (!pendingRef.current) return
    pendingRef.current = false
    clearTimer(showTimerRef)
    clearTimer(backstopTimerRef)
    setVisible(false)
  }, [pathname, search])

  useEffect(() => {
    const endPending = () => {
      pendingRef.current = false
      clearTimer(showTimerRef)
      clearTimer(backstopTimerRef)
      setVisible(false)
    }

    const startPending = () => {
      const alreadyPending = pendingRef.current
      pendingRef.current = true
      clearTimer(backstopTimerRef)
      backstopTimerRef.current = setTimeout(() => {
        endPending()
      }, NAVIGATION_PROGRESS_BACKSTOP_MS)
      if (alreadyPending) return
      showTimerRef.current = setTimeout(() => {
        showTimerRef.current = null
        if (pendingRef.current) setVisible(true)
      }, NAVIGATION_PROGRESS_SHOW_DELAY_MS)
    }

    const onClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest('a')
      if (!(anchor instanceof HTMLAnchorElement)) return

      if (
        !shouldStartNavigationProgress({
          button: event.button,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          currentUrl: window.location.href,
          href: anchor.href,
          target: anchor.getAttribute('target') ?? '',
          download: anchor.hasAttribute('download'),
          noProgress: anchor.hasAttribute('data-no-progress'),
        })
      ) {
        return
      }

      startPending()
    }

    const onPopState = () => {
      if (pendingRef.current) endPending()
    }

    document.addEventListener('click', onClick, true)
    window.addEventListener('popstate', onPopState)
    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('popstate', onPopState)
      clearTimer(showTimerRef)
      clearTimer(backstopTimerRef)
      pendingRef.current = false
    }
  }, [])

  if (!visible) return null

  return (
    <div
      data-testid="navigation-progress"
      aria-hidden="true"
      className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-brand"
    >
      <div className="h-full w-full bg-brand motion-safe:animate-[navigation-progress-sweep_1.1s_ease-in-out_infinite]" />
    </div>
  )
}
