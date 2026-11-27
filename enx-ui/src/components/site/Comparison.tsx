import FeatureRows, { type Feature } from './FeatureRows'

// Catglish against two categories of tool. No competitor is named (#1163).
const DIFFERENCES: Feature[] = [
  {
    title: 'Not a lookup extension',
    body: 'A lookup extension shows a definition and forgets the word when the popup closes. Catglish remembers every word you look up and underlines it the next time it appears, on any page.',
    imageAlt:
      'With a lookup extension the word looks like any other next time; with Catglish it comes back underlined',
    image: { src: '/landing/vs-lookup-extension.svg', width: 720, height: 440 },
  },
  {
    title: 'Not a full-page translator',
    body: 'A full-page translator hands you a Chinese page, and you stop reading English. Catglish has no full-page translation, on purpose: the page stays in English and you translate only the sentence you are stuck on.',
    imageAlt:
      'A full-page translator turns the page into Chinese; Catglish keeps it in English and translates one sentence',
    image: {
      src: '/landing/vs-full-page-translator.svg',
      width: 720,
      height: 440,
    },
  },
]

export default function Comparison() {
  return (
    <section
      id="compare"
      className="scroll-mt-16 mx-auto max-w-6xl px-4 py-16 sm:px-6"
    >
      <h2 className="text-center text-3xl font-bold tracking-tight">
        How Catglish is different
      </h2>
      <FeatureRows rows={DIFFERENCES} />
    </section>
  )
}
