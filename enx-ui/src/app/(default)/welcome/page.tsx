import WelcomeGuide from '@/components/welcome/WelcomeGuide'
import { loadTrialTerms } from '@/lib/trialTerms'

// First-run onboarding (ADR-047). Outside the (app) group so a signed-out
// visitor sees it; the extension opens it with ?src=install on install.
// Dynamic: the sign-in step reads trial terms from enx-api (#1238).
export const dynamic = 'force-dynamic'

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string }>
}) {
  const [{ src }, trialTerms] = await Promise.all([
    searchParams,
    loadTrialTerms(),
  ])
  return (
    <WelcomeGuide fromInstall={src === 'install'} trialTerms={trialTerms} />
  )
}
