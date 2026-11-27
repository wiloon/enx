import type { Metadata } from 'next'
import { LegalPage, Section, Term } from '@/components/site/LegalPage'
import { SITE } from '@/lib/site'

export const metadata: Metadata = {
  title: `Data sources — ${SITE.name}`,
  description: `Where ${SITE.name} gets its dictionary definitions, and how they are licensed.`,
}

export default function DataSourcesPage() {
  return (
    <LegalPage
      title="Data sources"
      intro={`${SITE.name} looks up words from third-party dictionaries. This page names those sources and how they are licensed, so you can tell where a definition came from.`}
      locale="en"
      enHref="/data-sources"
    >
      <Section heading="English Wiktionary">
        <p>
          When your explanation language is English, definitions come from{' '}
          <Term>English Wiktionary</Term>, published under the{' '}
          <a
            href="https://creativecommons.org/licenses/by-sa/4.0/"
            className="underline underline-offset-4 hover:text-foreground"
            target="_blank"
            rel="noreferrer"
          >
            Creative Commons Attribution-ShareAlike 4.0 International
          </a>{' '}
          licence (CC BY-SA 4.0).
        </p>
        <p>
          The data was <Term>modified</Term>: filtered and reformatted for
          lookup in {SITE.name}. It is not a verbatim dump of Wiktionary.
        </p>
        <p>
          The extract was produced with{' '}
          <a
            href="https://github.com/tatuylonen/wiktextract"
            className="underline underline-offset-4 hover:text-foreground"
            target="_blank"
            rel="noreferrer"
          >
            Wiktextract
          </a>{' '}
          and distributed via{' '}
          <a
            href="https://kaikki.org/"
            className="underline underline-offset-4 hover:text-foreground"
            target="_blank"
            rel="noreferrer"
          >
            kaikki.org
          </a>
          .
        </p>
      </Section>

      <Section heading="ECDICT">
        <p>
          When your explanation language is Simplified Chinese, definitions
          come from <Term>ECDICT</Term> (the English-Chinese dictionary used by{' '}
          {SITE.name}), with optional AI fallback when a word is missing.
        </p>
      </Section>
    </LegalPage>
  )
}
