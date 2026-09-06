'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// Reading Stats (ADR-016): placeholder for the daily / weekly / monthly
// reading analytics. The charts and the enx-api endpoints behind them are a
// follow-up; this page exists so the app shell already has a home for them.
const PERIODS = [
  {
    title: 'Daily',
    body: 'Words looked up and sentences read each day.',
  },
  {
    title: 'Weekly',
    body: 'Your reading volume and new vocabulary, week over week.',
  },
  {
    title: 'Monthly',
    body: 'Long-run trends in how much you read and review.',
  },
]

export default function ReadingStatsPage() {
  return (
    <div className="mx-auto max-w-4xl p-6 md:p-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold">Reading Stats</h2>
        <p className="text-muted-foreground">
          Charts coming soon — this page will track the words you look up and
          the sentences you read over time.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {PERIODS.map((period) => (
          <Card key={period.title}>
            <CardHeader>
              <CardTitle>{period.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{period.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
