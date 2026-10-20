import { SAMPLE_ARTICLE } from '@/lib/sampleArticle'
import { toParagraphs } from '@/lib/readerText'

// The sample article (ADR-047 Decision 8) in the Reader's article element,
// which the extension's Reader adapter reads. Shown on /reader/sample and
// inside /welcome.
export default function SampleArticle({
  titleAs: Title = 'h1',
}: {
  titleAs?: 'h1' | 'h2'
}) {
  return (
    <>
      <Title className="text-2xl font-bold">{SAMPLE_ARTICLE.title}</Title>
      <article
        id="enx-reader-article"
        className="prose max-w-none whitespace-pre-wrap text-[17px] leading-7"
      >
        {toParagraphs(SAMPLE_ARTICLE.text).map((p, i) => (
          <p key={i} className="mb-4">
            {p}
          </p>
        ))}
      </article>
    </>
  )
}
