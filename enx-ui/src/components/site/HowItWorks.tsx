const STEPS = [
  {
    n: 1,
    title: 'Add the extension',
    body: 'One click from the Chrome Web Store.',
  },
  {
    n: 2,
    title: 'Turn on learning mode',
    body: 'Click the Catseye icon on any English page.',
  },
  {
    n: 3,
    title: 'Just read',
    body: 'New words get underlined, click to look up, select to translate. Everything you look up is saved for review.',
  },
]

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-16 border-y border-border/60 bg-muted/40">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-center text-3xl font-bold tracking-tight">
          How it works
        </h2>
        <ol className="mt-12 grid gap-8 sm:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="text-center">
              <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-brand text-sm font-semibold text-brand-foreground">
                {s.n}
              </span>
              <h3 className="mt-4 font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
