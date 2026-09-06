'use client'

import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// App home / overview (ADR-013, ADR-016). Auth gating and the page chrome
// (sidebar + topbar) live in the (app) route-group layout; this page is just
// the landing content.
const SHORTCUTS = [
  {
    title: 'Word Lookup',
    href: '/lookup',
    body: 'Look up English words to see their Chinese translation, IPA pronunciation, lookup count, and mastery status.',
  },
  {
    title: 'Rephrase',
    href: '/rephrase',
    body: 'Turn Chinese or rough English into the way an American teammate would phrase it, with alternatives and notes.',
  },
  {
    title: 'Reading Stats',
    href: '/stats',
    body: 'Track the words you look up and the sentences you read — daily, weekly, and monthly.',
  },
  {
    title: 'Billing',
    href: '/billing',
    body: 'Upgrade to Catseye Pro or buy AI translation credits, and check your current balance.',
  },
]

export default function AppHome() {
  const { user } = useAuth()

  return (
    <div className="mx-auto max-w-4xl p-6 md:p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold">
          Welcome{user?.username ? `, ${user.username}` : ''}!
        </h2>
        <p className="text-muted-foreground">Catseye</p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {SHORTCUTS.map((item) => (
          <Card key={item.href}>
            <CardHeader>
              <CardTitle>{item.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-muted-foreground">{item.body}</p>
              <Link href={item.href}>
                <Button className="w-full">Go to {item.title}</Button>
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
