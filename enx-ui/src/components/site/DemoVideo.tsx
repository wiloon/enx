'use client'

import { useEffect, useRef } from 'react'
import { SITE } from '@/lib/site'

// Demo-video slot (ADR-013 Decision 6). Empty demoVideoUrl => a 16:9 poster
// with a "Demo coming soon" badge; an .mp4/.webm => a silent looping <video>
// that starts itself once mounted. preload="none" keeps it off the first
// paint: nothing is fetched until play() runs. Under prefers-reduced-motion
// it stays on the poster and shows controls, so playing is the viewer's call.
export default function DemoVideo() {
  const url = SITE.demoVideoUrl
  const isFile = /\.(mp4|webm)(\?|$)/i.test(url)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      video.controls = true
      return
    }
    // React sets `muted` as a property, not an attribute; browsers only allow
    // autoplay of a muted video, so make sure before calling play().
    video.muted = true
    // A rejected play() (autoplay blocked) leaves the poster showing.
    video.play().catch(() => {})
  }, [])

  return (
    <section className="mx-auto max-w-4xl px-4 pb-16 sm:px-6">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-muted">
        {isFile ? (
          <video
            ref={videoRef}
            className="h-full w-full"
            muted
            loop
            playsInline
            preload="none"
            poster={SITE.demoPoster}
          >
            <source src={url} />
          </video>
        ) : (
          <div
            className="flex h-full w-full items-center justify-center bg-cover bg-center"
            style={{ backgroundImage: `url(${SITE.demoPoster})` }}
          >
            <span className="rounded-full bg-background/85 px-4 py-1.5 text-sm font-medium text-foreground shadow-sm">
              Demo coming soon
            </span>
          </div>
        )}
      </div>
    </section>
  )
}
