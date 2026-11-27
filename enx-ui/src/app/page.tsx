import type { Metadata } from 'next'
import SiteHeader from '@/components/site/SiteHeader'
import Hero from '@/components/site/Hero'
import DemoVideo from '@/components/site/DemoVideo'
import FeatureSection from '@/components/site/FeatureSection'
import HowItWorks from '@/components/site/HowItWorks'
import Comparison from '@/components/site/Comparison'
import InstallCTA from '@/components/site/InstallCTA'
import SiteFooter from '@/components/site/SiteFooter'

// Marketing landing page (ADR-013). Static — no auth, no data fetching. The
// app itself lives at /app.
export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: 'Catglish — Read English in English',
  description:
    'Catglish keeps you reading English. Get help with the one word or sentence you are stuck on, see what a word means in this sentence, and find the words you looked up underlined wherever they come back. No full-page translation.',
}

export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <DemoVideo />
        <FeatureSection />
        <HowItWorks />
        <Comparison />
        <InstallCTA />
      </main>
      <SiteFooter />
    </>
  )
}
