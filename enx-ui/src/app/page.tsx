import type { Metadata } from 'next'
import SiteHeader from '@/components/site/SiteHeader'
import Hero from '@/components/site/Hero'
import DemoVideo from '@/components/site/DemoVideo'
import FeatureSection from '@/components/site/FeatureSection'
import HowItWorks from '@/components/site/HowItWorks'
import Comparison from '@/components/site/Comparison'
import InstallCTA from '@/components/site/InstallCTA'
import CtaBanner from '@/components/site/CtaBanner'
import SiteFooter from '@/components/site/SiteFooter'

// Marketing landing page (ADR-013). Static — no auth, no data fetching. The
// app itself lives at /app.
export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: 'Catseye — AI-assisted English reading in your browser',
  description:
    'Catseye underlines the words worth learning as you read English online, explains any word you click, and translates whole sentences on demand.',
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
        <CtaBanner />
      </main>
      <SiteFooter />
    </>
  )
}
