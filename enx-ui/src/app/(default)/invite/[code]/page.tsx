import type { Metadata } from 'next'
import SiteHeader from '@/components/site/SiteHeader'
import SiteFooter from '@/components/site/SiteFooter'
import InviteLanding from '@/components/site/InviteLanding'
import { SITE } from '@/lib/site'

// Public landing page of an invite link (ADR-051). Personal links, so kept
// out of search results.
export const metadata: Metadata = {
  title: `You're invited — ${SITE.name}`,
  robots: { index: false, follow: false },
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  return (
    <>
      <SiteHeader />
      <main className="px-4 py-16 sm:px-6">
        <InviteLanding code={decodeURIComponent(code)} />
      </main>
      <SiteFooter />
    </>
  )
}
