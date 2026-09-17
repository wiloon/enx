// Similar apps in this space, ranked by reach (Chrome Web Store users, or
// GitHub stars where the project is open source). No feature comparison —
// see market-research.md if that's needed elsewhere.
type App = {
  name: string
  url: string
  description: string
  users?: number
  stars?: number
}

const APPS: App[] = [
  {
    name: 'Immersive Translate',
    url: 'https://immersivetranslate.com',
    description: 'Dual-language webpage, PDF, and video subtitle translator. Open source.',
    users: 3_000_000,
    stars: 18_900,
  },
  {
    name: 'Language Reactor',
    url: 'https://www.languagereactor.com',
    description: 'Dual subtitles and popup dictionary for learning from Netflix and YouTube.',
    users: 2_000_000,
  },
  {
    name: 'Trancy',
    url: 'https://www.trancy.org',
    description: 'AI bilingual subtitles, webpage translation, vocabulary, and speaking practice.',
    users: 300_000,
  },
  {
    name: 'Toucan by Babbel',
    url: 'https://www.jointoucan.com',
    description: 'Swaps words on pages you browse for target-language translations, with a review dashboard.',
    users: 200_000,
  },
  {
    name: 'Readlang',
    url: 'https://readlang.com',
    description: 'Reads foreign-language web pages, translates clicked words, builds flashcards.',
    users: 100_000,
  },
  {
    name: 'Rememberry',
    url: 'https://www.rememberry.in',
    description: 'Translates words while browsing and turns them into spaced-repetition flashcards.',
    users: 100_000,
  },
  {
    name: 'TransOver',
    url: 'https://github.com/hanxue/transover',
    description: 'Hover, click, or select to translate any word or phrase on a page. Open source.',
    users: 100_000,
  },
  {
    name: 'KISS Translator',
    url: 'https://github.com/fishjar/kiss-translator',
    description: 'Minimalist bilingual webpage, selection, and video subtitle translator. Open source.',
    users: 100_000,
    stars: 12_500,
  },
  {
    name: 'Read Frog',
    url: 'https://github.com/mengxi-ream/read-frog',
    description: 'Dual-language webpage and PDF translator with vocabulary review for language learners. Open source.',
    stars: 9_715,
  },
  {
    name: 'LingQ',
    url: 'https://www.lingq.com',
    description: 'Imports web articles and video captions into a lookup-and-review reader.',
    users: 80_000,
  },
  {
    name: 'NeonLingo',
    url: 'https://www.neonlingo.com',
    description: 'AI in-context word lookup that highlights saved words again wherever they reappear.',
    users: 3_000,
  },
  {
    name: 'VocabTracker',
    url: 'https://www.vocabtracker.com',
    description: 'Highlights words on any page by familiarity. Inspired by LingQ, Readlang, and LWT.',
    users: 3_000,
  },
  {
    name: 'Sentiaread',
    url: 'https://sentiaread.com',
    description: 'AI reader that explains words in context and simplifies sentences to your level.',
    users: 1_000,
  },
].sort((a, b) => (b.users ?? b.stars ?? 0) - (a.users ?? a.stars ?? 0))

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return `${n}`
}

const AS_OF = 'September 2026'

export default function Comparison() {
  return (
    <section id="compare" className="scroll-mt-16 mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h2 className="text-center text-3xl font-bold tracking-tight">
        Similar apps in this space
      </h2>

      <ul className="mt-10 divide-y divide-border/60 border-y border-border">
        {APPS.map((app) => (
          <li key={app.name} className="flex flex-wrap items-baseline justify-between gap-2 py-4">
            <div>
              <a
                href={app.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold hover:underline"
              >
                {app.name}
              </a>
              <p className="text-sm text-muted-foreground">{app.description}</p>
            </div>
            <div className="text-sm text-muted-foreground">
              {app.users != null && <span>{formatCount(app.users)} users</span>}
              {app.stars != null && (
                <span>
                  {app.users != null ? ' · ' : ''}
                  {formatCount(app.stars)} GitHub stars
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-center text-xs text-muted-foreground/70">
        Ranked by Chrome Web Store users, or GitHub stars where the project is open source.
        Figures are public and approximate as of {AS_OF}.
      </p>
    </section>
  )
}
