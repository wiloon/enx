import FeatureRows, { type Feature } from './FeatureRows'

// Reading features only; Rephrase is a writing tool and lives in Help.
const FEATURES: Feature[] = [
  {
    title: 'Looked-up words come back underlined',
    body: "Words you've looked up get a colored underline wherever they appear again, fading the more often you've looked each one up. It's a toggle — turn it off and the page is clean, click-to-look-up still works.",
    imageAlt:
      'An article with looked-up words underlined in shades of one color',
    image: { src: '/landing/word-highlight.png', width: 1260, height: 890 },
  },
  {
    title: 'What a word means in this sentence',
    body: "A dictionary entry lists every meaning a word can have. Click a word and Catglish also tells you which one fits the sentence you are reading, so you don't have to guess.",
    imageAlt:
      'A clicked word in a sentence, and the side panel showing the one meaning that fits this sentence',
    image: { src: '/landing/in-context-meaning.svg', width: 720, height: 440 },
  },
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
      <FeatureRows rows={FEATURES} />
    </section>
  )
}
