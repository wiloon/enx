// Competitor comparison (ADR-013 Decision 3 / H1). Facts only, drawn from
// w10n-config/enx/market-research.md §4.2 — no strategic framing on the page.
type Cell = 'yes' | 'partial' | 'no'

const COLUMNS = ['Catseye', 'Immersive Translate', 'Readlang', 'LingQ', 'Language Reactor']

const ROWS: { label: string; cells: Cell[] }[] = [
  { label: "Works on the English page you're actually reading", cells: ['yes', 'yes', 'yes', 'partial', 'partial'] },
  { label: 'Underlines words by your level', cells: ['yes', 'no', 'no', 'partial', 'no'] },
  { label: 'Click a word for its meaning, in place', cells: ['yes', 'partial', 'yes', 'yes', 'yes'] },
  { label: "Tracks what you've looked up over time", cells: ['yes', 'no', 'yes', 'yes', 'partial'] },
  { label: 'Exam-vocabulary mastery (IELTS / TOEFL / CET)', cells: ['yes', 'no', 'no', 'no', 'no'] },
  { label: 'Mastery growth curve', cells: ['yes', 'no', 'no', 'partial', 'no'] },
  { label: 'AI meaning-in-context (not just a dictionary entry)', cells: ['yes', 'yes', 'no', 'no', 'partial'] },
  { label: 'Sentence translation on demand', cells: ['yes', 'yes', 'yes', 'yes', 'yes'] },
  { label: 'Chinese-native explanations', cells: ['yes', 'yes', 'no', 'no', 'partial'] },
]

const MARK: Record<Cell, { glyph: string; label: string }> = {
  yes: { glyph: '✓', label: 'yes' },
  partial: { glyph: '~', label: 'partial' },
  no: { glyph: '—', label: 'no' },
}

const AS_OF = 'September 2026'

export default function Comparison() {
  return (
    <section id="compare" className="scroll-mt-16 mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h2 className="text-center text-3xl font-bold tracking-tight">
        Plenty of tools translate the web. Catseye is built to help you learn from it.
      </h2>

      <div className="mt-10 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="py-3 pr-4 text-left font-medium text-muted-foreground">Capability</th>
              {COLUMNS.map((c, i) => (
                <th
                  key={c}
                  className={`px-3 py-3 text-center font-semibold ${
                    i === 0 ? 'text-brand' : 'text-muted-foreground'
                  }`}
                  aria-current={i === 0 ? 'true' : undefined}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label} className="border-b border-border/60">
                <th scope="row" className="py-3 pr-4 text-left font-normal">
                  {row.label}
                </th>
                {row.cells.map((cell, i) => (
                  <td
                    key={i}
                    className={`px-3 py-3 text-center ${
                      i === 0 ? 'bg-brand/5 font-semibold text-brand' : 'text-foreground/70'
                    }`}
                  >
                    <span aria-label={MARK[cell].label}>{MARK[cell].glyph}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-muted-foreground">
        Catseye is the only one that combines real webpage reading, passive
        mastery tracking, and exam-vocabulary progress in one place.
      </p>
      <p className="mt-2 text-center text-xs text-muted-foreground/70">
        Comparison based on publicly available information as of {AS_OF}. Features
        change — corrections welcome.
      </p>
    </section>
  )
}
