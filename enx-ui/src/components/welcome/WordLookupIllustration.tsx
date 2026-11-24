import { SITE } from '@/lib/site'

export const WORD_LOOKUP_ILLUSTRATION = {
  src: '/onboarding/word-lookup.svg',
  alt: `An English article: click a word and ${SITE.name} shows its meaning in a small card`,
  caption: 'Click any word while you read — see its meaning in context.',
}

// What setup buys a visitor, shown beside the steps once the extension is in
// (ADR-047 #872) and as the walkthrough's last slide (#1101). Not a link:
// Continue keeps the attention.
export default function WordLookupIllustration() {
  return (
    <figure className="space-y-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- a static
          illustration from public/, nothing to optimize */}
      <img
        src={WORD_LOOKUP_ILLUSTRATION.src}
        alt={WORD_LOOKUP_ILLUSTRATION.alt}
        width={480}
        height={360}
        className="h-auto w-full max-w-xl"
      />
      <figcaption className="text-sm text-muted-foreground">
        {WORD_LOOKUP_ILLUSTRATION.caption}
      </figcaption>
    </figure>
  )
}
