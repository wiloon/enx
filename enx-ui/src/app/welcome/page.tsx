import WelcomeGuide from '@/components/welcome/WelcomeGuide'

// First-run onboarding (ADR-047). Outside the (app) group so a signed-out
// visitor sees it; the extension opens it with ?src=install on install.
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string }>
}) {
  const { src } = await searchParams
  return <WelcomeGuide fromInstall={src === 'install'} />
}
