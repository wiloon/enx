import { Fragment } from 'react'

export interface Feature {
  title: string
  body: string
  imageAlt: string
  // Screenshots live in public/landing/. width and height are the file's
  // pixel size, so the browser reserves the space before the image loads.
  image: { src: string; width: number; height: number }
}

// Reading features only; Rephrase is a writing tool and lives in Help.
const FEATURES: Feature[] = [
  {
    title: 'Click any word for its meaning',
    body: "Click a word in the text and a popup shows its definition, IPA, how many times you've looked it up, and whether you've marked it known. No setup — it works whenever Catglish is on.",
    imageAlt: 'A word lookup popup over an English article',
    image: { src: '/landing/click-word.png', width: 1260, height: 890 },
  },
  {
    title: 'Select a sentence to translate it',
    body: 'Drag-select a full sentence and Catglish translates it in the side panel, keeping the original in view. Select a short phrase instead and it explains the phrase in context.',
    imageAlt:
      "The side panel showing a sentence, its translation and the clicked word's meaning in context",
    image: { src: '/landing/translate-sentence.png', width: 885, height: 430 },
  },
  {
    title: 'Word highlight while you read',
    body: "Words you've looked up get a colored underline wherever they appear again, fading the more often you've looked each one up. It's a toggle — turn it off and the page is clean, click-to-look-up still works.",
    imageAlt:
      'An article with looked-up words underlined in shades of one color',
    image: { src: '/landing/word-highlight.png', width: 1260, height: 890 },
  },
]

export default function FeatureSection() {
  return (
    <section
      id="features"
      className="scroll-mt-16 mx-auto max-w-6xl px-4 py-16 sm:px-6"
    >
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
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={f.image.src}
                  width={f.image.width}
                  height={f.image.height}
                  alt={f.imageAlt}
                  loading="lazy"
                  className="h-auto w-full rounded-lg border border-border shadow-sm"
                />
              </div>
            </div>
          </Fragment>
        ))}
      </div>
    </section>
  )
}
