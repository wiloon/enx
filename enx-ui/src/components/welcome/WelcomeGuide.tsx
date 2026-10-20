'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Circle, CircleSlash } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useExtensionStatusPoll } from '@/hooks/useExtensionStatusPoll'
import { useLearningModeMark } from '@/hooks/useLearningModeMark'
import { apiService } from '@/services/api'
import { isChromium, webStoreUrl } from '@/lib/enxExtension'
import {
  onboardingComplete,
  onboardingSteps,
  welcomeLanding,
  type OnboardingStep,
  type WelcomeLanding,
} from '@/lib/onboarding'
import { RECOMMENDED_SITES } from '@/lib/recommendedSites'
import { SITE } from '@/lib/site'
import SampleArticle from '@/components/reader/SampleArticle'
import { Button } from '@/components/ui/button'

// How often /welcome asks the extension for its status and re-reads the
// user's lookups while waiting on a step (ADR-047 Decision 2).
const POLL_MS = 2000

const FINAL_LANDINGS: ReadonlySet<WelcomeLanding> = new Set([
  'steps',
  'done',
  'app',
])

// The first-run guide (ADR-047). Every step is ticked from real state; the
// sample article sits beside the steps and is never auto-enabled -- the user
// turns learning mode on from the toolbar, the habit they need on every
// other site.
export default function WelcomeGuide({
  fromInstall,
  pollMs = POLL_MS,
}: {
  fromInstall: boolean
  pollMs?: number
}) {
  const router = useRouter()
  const { isLoading, isAuthenticated } = useAuth()
  const signedIn = isLoading ? undefined : isAuthenticated
  const learningEnabled = useLearningModeMark()
  const [pinSkipped, setPinSkipped] = useState(false)

  const preferences = useQuery({
    queryKey: ['preferences'],
    queryFn: async () => {
      const resp = await apiService.getPreferences()
      if (resp.success && resp.data) return resp.data
      throw new Error(resp.error || 'Failed to load preferences')
    },
    enabled: signedIn === true,
  })

  // Lookups ever made: the word list grows from a lookup anywhere (same
  // signal as Home, ADR-027).
  const lookups = useQuery({
    queryKey: ['stats-overview'],
    queryFn: async () => {
      const resp = await apiService.getStatsOverview()
      if (resp.success && resp.data) return resp.data
      throw new Error(resp.error || 'Failed to load statistics')
    },
    enabled: signedIn === true,
    // Only a user still on the guide is waiting for their first lookup.
    refetchInterval: (query) =>
      preferences.data?.onboardingCompleted?.effective ||
      (query.state.data?.vocab.total ?? 0) > 0
        ? false
        : pollMs,
  })

  // A failed read counts as "new user": the guide shows once more, which is
  // the cheap mistake (Decision 1a).
  const onboardingCompleted = preferences.isError
    ? false
    : preferences.data?.onboardingCompleted?.effective
  const hasLookedUp = lookups.isError
    ? false
    : lookups.data
      ? lookups.data.vocab.total > 0
      : undefined

  // Decided once: a new user's first lookup must not turn them into a
  // "returning user" and bounce them to /app mid-guide.
  const computed = welcomeLanding({
    signedIn,
    fromInstall,
    onboardingCompleted,
    hasLookedUp,
  })
  const [locked, setLocked] = useState<WelcomeLanding | null>(null)
  if (locked === null && FINAL_LANDINGS.has(computed)) setLocked(computed)
  const landing = locked ?? computed

  // Once finished, stays finished: turning learning mode off afterwards must
  // not bring the steps back.
  const [reachedDone, setReachedDone] = useState(false)
  const complete = onboardingComplete({
    learningEnabled,
    hasLookedUp: hasLookedUp ?? false,
  })
  if (!reachedDone && landing === 'steps' && complete) setReachedDone(true)
  const finished = landing === 'done' || reachedDone

  const extension = useExtensionStatusPoll({
    enabled: !finished && landing !== 'app',
    watchToolbar: landing === 'steps' && !pinSkipped,
    intervalMs: pollMs,
  })

  const progress = onboardingSteps(
    {
      installed: extension?.installed ?? false,
      signedIn: signedIn === true,
      isOnToolbar: extension?.isOnToolbar ?? false,
      pinSkipped,
      learningEnabled,
      hasLookedUp: hasLookedUp ?? false,
    },
    landing === 'sign-in' ? 'signed-out' : 'full'
  )

  const queryClient = useQueryClient()
  // Later visits in this session must see the flag, not the cached answer.
  const refreshPreferences = () =>
    queryClient.invalidateQueries({ queryKey: ['preferences'] })

  const recordCompleted = useMutation({
    mutationFn: async () => {
      const resp = await apiService.updatePreferences({
        onboardingCompleted: true,
      })
      if (!resp.success) throw new Error(resp.error || 'Failed to save')
      return resp
    },
    retry: 1,
    onSettled: refreshPreferences,
  })
  const { mutate: record, isIdle: notYetRecorded } = recordCompleted
  useEffect(() => {
    if (reachedDone && notYetRecorded) record()
  }, [reachedDone, notYetRecorded, record])

  // Home's ExtensionBanner then reads "Catglish extension connected".
  useEffect(() => {
    if (landing === 'app') router.replace('/app')
  }, [landing, router])

  const skipSetup = async () => {
    if (signedIn) {
      // A failed write still leaves: the guide showing once more is the
      // cheap mistake (Decision 1a).
      await apiService.updatePreferences({ onboardingCompleted: true })
      await refreshPreferences()
    }
    router.push('/app')
  }

  const returnTo = fromInstall ? '/welcome?src=install' : '/welcome'

  // Until the extension has answered, whether the install step belongs in
  // the list is unknown; guessing either way makes it flash.
  const stepList = (steps: OnboardingStep[]) =>
    extension === undefined ? (
      <Loading />
    ) : (
      <StepList
        steps={steps}
        returnTo={returnTo}
        onSkipPin={() => setPinSkipped(true)}
      />
    )

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-10 p-6 md:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] md:p-10">
      <section className="space-y-6">
        {finished ? (
          <Finished />
        ) : landing === 'sign-in' ? (
          <>
            <h1 className="text-2xl font-bold">
              Welcome to {SITE.name} — sign in to get started
            </h1>
            {stepList(progress.steps)}
            <SkipSetup onClick={skipSetup} />
          </>
        ) : landing === 'steps' ? (
          <>
            <h1 className="text-2xl font-bold">Welcome to {SITE.name}</h1>
            {stepList(progress.steps)}
            <SkipSetup onClick={skipSetup} />
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold">Welcome to {SITE.name}</h1>
            <Loading />
            <SkipSetup onClick={skipSetup} />
          </>
        )}
      </section>

      <section className="space-y-4" aria-label="Sample article">
        <SampleArticle titleAs="h2" />
      </section>
    </div>
  )
}

function StepList({
  steps,
  returnTo,
  onSkipPin,
}: {
  steps: OnboardingStep[]
  returnTo: string
  onSkipPin: () => void
}) {
  return (
    <ol className="space-y-5">
      {steps.map((step) => (
        <li key={step.id} className="flex gap-3 text-sm">
          <StepIcon status={step.status} />
          <div className="min-w-0 flex-1 space-y-2">
            <p
              className={
                step.status === 'todo'
                  ? 'font-medium'
                  : 'font-medium text-muted-foreground'
              }
            >
              {step.title}
            </p>
            {step.status === 'todo' && (
              <StepDetail
                id={step.id}
                returnTo={returnTo}
                onSkipPin={onSkipPin}
              />
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

function StepIcon({ status }: { status: OnboardingStep['status'] }) {
  if (status === 'done') {
    return (
      <span className="mt-0.5 shrink-0" aria-label="Done">
        <Check aria-hidden className="size-4 text-brand" />
      </span>
    )
  }
  if (status === 'skipped') {
    return (
      <span className="mt-0.5 shrink-0" aria-label="Skipped">
        <CircleSlash aria-hidden className="size-4 text-muted-foreground" />
      </span>
    )
  }
  return (
    <span className="mt-0.5 shrink-0" aria-label="To do">
      <Circle aria-hidden className="size-4 text-muted-foreground" />
    </span>
  )
}

function StepDetail({
  id,
  returnTo,
  onSkipPin,
}: {
  id: OnboardingStep['id']
  returnTo: string
  onSkipPin: () => void
}) {
  switch (id) {
    case 'install':
      return <InstallButton />
    case 'sign-in': {
      const redirect = encodeURIComponent(returnTo)
      return (
        <div className="flex gap-2">
          <Button asChild variant="brand" size="sm">
            <Link href={`/sign-in?redirect_url=${redirect}`}>Sign in</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/sign-up?redirect_url=${redirect}`}>Sign up</Link>
          </Button>
        </div>
      )
    }
    case 'pin':
      return (
        <div className="space-y-2">
          <p className="text-muted-foreground">
            Click the puzzle-piece icon in Chrome&apos;s toolbar, then the pin
            next to {SITE.name}. Its badge shows when {SITE.name} is on.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- a static
              illustration from public/, nothing to optimize */}
          <img
            src="/onboarding/pin-icon.svg"
            alt={`Chrome toolbar: click the puzzle-piece icon, then the pin next to ${SITE.name}`}
            width={360}
            height={200}
            className="w-full max-w-sm rounded-md border"
          />
          <Button variant="ghost" size="sm" onClick={onSkipPin}>
            Skip
          </Button>
        </div>
      )
    default:
      return null
  }
}

function InstallButton() {
  const storeUrl = webStoreUrl()
  const [chromium] = useState(
    () => typeof navigator === 'undefined' || isChromium(navigator.userAgent)
  )
  return (
    <div className="space-y-2">
      {storeUrl ? (
        <Button asChild variant="brand" size="sm">
          <a href={storeUrl} target="_blank" rel="noopener noreferrer">
            Add to Chrome
          </a>
        </Button>
      ) : (
        <Button variant="brand" size="sm" disabled>
          Coming soon to the Chrome Web Store
        </Button>
      )}
      {!chromium && (
        <p className="text-muted-foreground">
          {SITE.name} needs Chrome (or another Chromium browser such as Edge).
        </p>
      )}
    </div>
  )
}

function Loading() {
  return <p className="text-sm text-muted-foreground">Loading…</p>
}

function SkipSetup({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="link" size="sm" className="px-0" onClick={onClick}>
      Skip setup
    </Button>
  )
}

function Finished() {
  return (
    <>
      <h1 className="text-2xl font-bold">You&apos;re all set</h1>
      <p className="text-sm">
        On any English article, click the {SITE.name} icon in your toolbar, then{' '}
        <span className="font-medium">Read with {SITE.name}</span>.
      </p>
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Something to read</h2>
        <ul className="space-y-2 text-sm">
          {RECOMMENDED_SITES.map((site) => (
            <li key={site.url}>
              <a
                href={site.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-brand underline-offset-4 hover:underline"
              >
                {site.name}
              </a>
              <span className="text-muted-foreground">
                {' '}
                — {site.description}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <Link
        href="/app"
        className="inline-block text-sm font-medium underline-offset-4 hover:underline"
      >
        Go to your dashboard
      </Link>
    </>
  )
}
