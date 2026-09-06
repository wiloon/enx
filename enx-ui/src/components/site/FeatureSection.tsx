import { Fragment } from 'react'

export interface Feature {
  title: string
  body: string
  imageAlt: string
  imageSrc?: string
}

const FEATURES: Feature[] = [
  {
    title: 'Word highlight while you read',
    body: "Words worth reviewing get a colored underline, graded by how far along you are with each one. It's a toggle — turn it off and the page is clean, click-to-look-up still works.",
    imageAlt: 'An article with new words underlined in different colors',
  },
  {
    title: 'Click any word for its meaning',
    body: "Click a word in the text and a popup shows its definition, IPA, how many times you've looked it up, and its review status. No setup — it follows learning mode.",
    imageAlt: 'A word lookup popup over an English article',
  },
  {
    title: 'Select a sentence to translate it',
    body: 'Drag-select a full sentence and Catseye translates it in the side panel, keeping the original in view. Select a short phrase instead and it explains the phrase in context.',
    imageAlt: 'The browser side panel showing a translated sentence',
  },
  {
    title: 'Idiomatic phrasing',
    body: 'Writing to an American teammate? Paste Chinese or rough English and Catseye rewrites it the way a colleague would actually say it — with alternatives and short notes on what changed.',
    imageAlt: 'The idiomatic phrasing page with alternatives and notes',
  },
]

function Placeholder({ alt }: { alt: string }) {
  return (
    <div
      role="img"
      aria-label={alt}
      className="aspect-[4/3] w-full rounded-lg border border-border bg-gradient-to-br from-muted to-background"
    />
  )
}

export default function FeatureSection() {
  return (
    <section id="features" className="scroll-mt-16 mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h2 className="text-center text-3xl font-bold tracking-tight">
        Read the web. Learn from it.
      </h2>
      <div className="mt-14 space-y-16">
        {FEATURES.map((f, i) => (
          <Fragment key={f.title}>
            <div className="grid items-center gap-8 md:grid-cols-2">
              <div className={i % 2 === 1 ? 'md:order-2' : undefined}>
                <h3 className="text-xl font-semibold">{f.title}</h3>
                <p className="mt-3 text-muted-foreground">{f.body}</p>
              </div>
              <div className={i % 2 === 1 ? 'md:order-1' : undefined}>
                {f.imageSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={f.imageSrc}
                    alt={f.imageAlt}
                    className="w-full rounded-lg border border-border"
                  />
                ) : (
                  <Placeholder alt={f.imageAlt} />
                )}
              </div>
            </div>
          </Fragment>
        ))}
      </div>
    </section>
  )
}
