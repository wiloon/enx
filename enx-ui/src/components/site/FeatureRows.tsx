export interface Feature {
  title: string
  body: string
  imageAlt: string
  // Images live in public/landing/. width and height are the file's pixel
  // size, so the browser reserves the space before the image loads.
  image: { src: string; width: number; height: number }
}

// Text beside image, the sides alternating from row to row; stacked on a
// phone, text first.
export default function FeatureRows({ rows }: { rows: readonly Feature[] }) {
  return (
    <div className="mt-14 space-y-16">
      {rows.map((row, i) => (
        <div key={row.title} className="grid items-center gap-8 md:grid-cols-2">
          <div className={i % 2 === 1 ? 'md:order-2' : undefined}>
            <h3 className="text-xl font-semibold">{row.title}</h3>
            <p className="mt-3 text-muted-foreground">{row.body}</p>
          </div>
          <div className={i % 2 === 1 ? 'md:order-1' : undefined}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={row.image.src}
              width={row.image.width}
              height={row.image.height}
              alt={row.imageAlt}
              loading="lazy"
              className="h-auto w-full rounded-lg border border-border shadow-sm"
            />
          </div>
        </div>
      ))}
    </div>
  )
}
