import { SITE } from '@/lib/site'

// Reserved demo-video slot (ADR-013 Decision 6). Empty demoVideoUrl => a 16:9
// poster with a "Demo coming soon" badge; an .mp4/.webm => a real <video> with
// preload="none" so it never touches the first paint.
export default function DemoVideo() {
  const url = SITE.demoVideoUrl
  const isFile = /\.(mp4|webm)(\?|$)/i.test(url)

  return (
    <section className="mx-auto max-w-4xl px-4 pb-16 sm:px-6">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-muted">
        {isFile ? (
          <video
            className="h-full w-full"
            controls
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
