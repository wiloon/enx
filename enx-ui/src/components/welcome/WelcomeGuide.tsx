'use client'

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Circle,
  CircleCheck,
  CircleDot,
  CircleSlash,
} from 'lucide-react'
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
import { ENHANCED_PROTECTION_NOTE } from '@/lib/help'
import SampleArticle from '@/components/reader/SampleArticle'
import BrandMark from '@/components/site/BrandMark'
import { Button } from '@/components/ui/button'

// How often /welcome asks the extension for its status and re-reads the
// user's lookups while waiting on a step (ADR-047 Decision 2).
const POLL_MS = 2000
const PIN_SKIPPED_KEY = 'enx.onboarding.pinSkipped'
const subscribeToPinSkip = () => () => {}
const serverPinSkipped = () => false
const readPinSkipped = () => {
  try {
    return localStorage.getItem(PIN_SKIPPED_KEY) === 'true'
  } catch {
    return false
  }
}

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
  const [skippedThisVisit, setPinSkipped] = useState(false)
  const savedPinSkipped = useSyncExternalStore(
    subscribeToPinSkip,
    readPinSkipped,
    serverPinSkipped
  )
  const pinSkipped = skippedThisVisit || savedPinSkipped

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
    enabled: landing !== 'app',
    watchToolbar: (landing === 'steps' || landing === 'sign-in') && !pinSkipped,
    intervalMs: pollMs,
    live: finished,
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
  // Only a signed-in user reaches the finished view.
  const setupStatus = onboardingSteps(
    {
      installed: extension?.installed ?? false,
      signedIn: true,
      isOnToolbar: extension?.isOnToolbar ?? false,
      pinSkipped,
      learningEnabled: false,
      hasLookedUp: false,
    },
    'check'
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

  // A visitor goes home, not to /app: /app would send them to sign in and
  // back here (ADR-047 #872). Unknown sign-in status counts as signed out.
  const skipSetup = async () => {
    if (signedIn !== true) {
      router.push('/')
      return
    }
    // A failed write still leaves: the guide showing once more is the
    // cheap mistake (Decision 1a).
    const response = await apiService.updatePreferences({
      onboardingCompleted: true,
    })
    if (response.success && response.data) {
      // Discard an older read before publishing the server's updated preferences.
      await queryClient.cancelQueries({ queryKey: ['preferences'] })
      queryClient.setQueryData(['preferences'], response.data)
    }
    void refreshPreferences()
    router.push('/app')
  }

  const returnTo = fromInstall ? '/welcome?src=install' : '/welcome'

  // Until detection answers, do not guess whether installation is done.
  const stepList = (steps: OnboardingStep[], onSkipPin?: () => void) =>
    extension === undefined ? (
      <p
        role="status"
        aria-label="Checking extension"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-brand/20 border-t-brand motion-reduce:animate-none"
        />
        Checking extension…
      </p>
    ) : (
      <StepList steps={steps} returnTo={returnTo} onSkipPin={onSkipPin} />
    )
  const skipPin = () => {
    setPinSkipped(true)
    try {
      localStorage.setItem(PIN_SKIPPED_KEY, 'true')
    } catch {
      // Keep the skip for this visit when storage is unavailable.
    }
  }

  const showArticle = landing === 'steps' || finished
  // Signed in but still loading keeps one column: the article waits for the
  // account history (#846), and the illustration is for visitors only.
  const showIllustration = !showArticle && signedIn !== true

  return (
    <>
      {/* Not a link: the guide should not invite leaving (ADR-047 #872). */}
      <header className="mx-auto flex w-full max-w-6xl items-center gap-2 px-6 pt-6 font-semibold md:px-10">
        <BrandMark />
      </header>
      <div
        className={`mx-auto grid w-full gap-10 p-6 md:p-10 ${showArticle || showIllustration ? 'max-w-6xl md:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]' : 'max-w-xl'}`}
      >
        <section className="space-y-6">
          {finished ? (
            <Finished setupStatus={stepList(setupStatus.steps)} />
          ) : landing === 'sign-in' ? (
            <>
              <h1 className="text-2xl font-bold">Welcome to {SITE.name}</h1>
              {stepList(progress.steps, skipPin)}
              <SkipSetup onClick={skipSetup} signedIn={signedIn === true} />
            </>
          ) : landing === 'steps' ? (
            <>
              <h1 className="text-2xl font-bold">Welcome to {SITE.name}</h1>
              {stepList(progress.steps, skipPin)}
              <SkipSetup onClick={skipSetup} signedIn={signedIn === true} />
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold">Welcome to {SITE.name}</h1>
              <Loading />
              <SkipSetup onClick={skipSetup} signedIn={signedIn === true} />
            </>
          )}
        </section>

        {showArticle && (
          <section className="space-y-4" aria-label="Sample article">
            <SampleArticle titleAs="h2" />
          </section>
        )}
        {showIllustration && <WordLookupIllustration />}
      </div>
    </>
  )
}

function StepList({
  steps,
  returnTo,
  onSkipPin,
}: {
  steps: OnboardingStep[]
  returnTo: string
  /** Without it, the pin step offers no Skip. */
  onSkipPin?: () => void
}) {
  const nextId = steps.find((step) => step.status === 'todo')?.id
  const [showSkippedPin, setShowSkippedPin] = useState(false)
  return (
    <ol className="space-y-5">
      {steps.map((step) => (
        <li
          key={step.id}
          className="flex gap-3 text-sm"
          aria-current={step.id === nextId ? 'step' : undefined}
        >
          <StepIcon status={step.status} current={step.id === nextId} />
          <div className="min-w-0 flex-1 space-y-2">
            {step.id === 'pin' && step.status === 'skipped' && !onSkipPin ? (
              <button
                type="button"
                aria-expanded={showSkippedPin}
                onClick={() => setShowSkippedPin((shown) => !shown)}
                className="font-medium text-muted-foreground hover:text-foreground active:opacity-80 focus-visible:outline-2 focus-visible:outline-brand"
              >
                {step.title}
              </button>
            ) : (
              <p
                className={
                  step.id === nextId
                    ? 'font-medium text-foreground'
                    : step.status === 'skipped'
                      ? 'font-medium text-muted-foreground'
                      : 'text-muted-foreground'
                }
              >
                {step.title}
              </p>
            )}
            {(step.id === nextId ||
              (step.id === 'pin' &&
                step.status === 'skipped' &&
                !onSkipPin &&
                showSkippedPin)) && (
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

function StepIcon({
  status,
  current,
}: {
  status: OnboardingStep['status']
  current: boolean
}) {
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
  if (current) {
    return (
      <span className="mt-0.5 shrink-0" aria-label="Current step">
        <CircleDot aria-hidden className="size-4 text-brand" />
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
  onSkipPin?: () => void
}) {
  switch (id) {
    case 'install':
      return <InstallButton />
    case 'sign-in': {
      const redirect = encodeURIComponent(returnTo)
      return (
        <div className="space-y-2">
          <p className="text-muted-foreground">
            Free to start. Your saved words follow you to any device.
          </p>
          <Button asChild variant="brand" size="sm">
            <Link href={`/sign-in?redirect_url=${redirect}`}>Continue</Link>
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
          {onSkipPin && (
            <Button variant="ghost" size="sm" onClick={onSkipPin}>
              Skip
            </Button>
          )}
        </div>
      )
    case 'enable':
      return (
        <p className="text-muted-foreground">
          <span>
            Click the {SITE.name} icon in your toolbar, then Read with{' '}
            {SITE.name}.
          </span>{' '}
          <span aria-hidden="true" className="text-brand">
            ↗
          </span>
        </p>
      )
    case 'look-up':
      return (
        <p className="text-muted-foreground">
          <span className="hidden md:inline">
            Try any word in the article on the right →
          </span>
          <span className="md:hidden">Try any word in the article below ↓</span>
        </p>
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
      <p className="text-muted-foreground">
        Install {SITE.name} to look up words while browsing English pages. After
        installing, return here to continue setup.
      </p>
      {storeUrl ? (
        <>
          <Button
            asChild
            variant="brand"
            size="sm"
            className="active:opacity-80"
          >
            <a href={storeUrl} target="_blank" rel="noopener noreferrer">
              Add to Chrome
            </a>
          </Button>
          <p className="rounded-md border border-warning bg-warning-muted p-3 text-warning-foreground">
            {ENHANCED_PROTECTION_NOTE}
          </p>
        </>
      ) : (
        <Button variant="brand" size="sm" disabled>
          Coming soon to the Chrome Web Store
        </Button>
      )}
      <p className="text-muted-foreground">
        Can’t access the Chrome Web Store?{' '}
        <Link
          href="/help/install/offline"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-sm text-brand hover:underline active:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          Install manually from a ZIP file
        </Link>
        .
      </p>
      {!chromium && (
        <p className="text-muted-foreground">
          {SITE.name} needs Chrome (or another Chromium browser such as Edge).
        </p>
      )}
    </div>
  )
}

// What setup buys a visitor, shown instead of the interactive article until
// they sign in (ADR-047 #872). Not a link: Continue keeps the attention.
function WordLookupIllustration() {
  return (
    <figure className="space-y-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- a static
          illustration from public/, nothing to optimize */}
      <img
        src="/onboarding/word-lookup.svg"
        alt={`An English article: click a word and ${SITE.name} shows its meaning in a small card`}
        width={480}
        height={360}
        className="h-auto w-full max-w-xl"
      />
      <figcaption className="text-sm text-muted-foreground">
        Click any word while you read — see its meaning in context.
      </figcaption>
    </figure>
  )
}

function Loading() {
  return <p className="text-sm text-muted-foreground">Loading…</p>
}

// Findable but not encouraged: muted and always underlined, never brand
// colour or a filled button (ADR-047 #872).
function SkipSetup({
  onClick,
  signedIn,
}: {
  onClick: () => void
  signedIn: boolean
}) {
  return (
    <div className="space-y-1 text-sm text-muted-foreground">
      <button
        type="button"
        onClick={onClick}
        className="rounded-sm underline underline-offset-4 transition-colors hover:text-foreground active:text-foreground/80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        Skip setup
      </button>
      {signedIn && (
        <p className="text-muted-foreground">
          You can finish it later from your dashboard.
        </p>
      )}
    </div>
  )
}

// The setup status list sits above the heading (ADR-047 #873).
function Finished({ setupStatus }: { setupStatus: ReactNode }) {
  return (
    <>
      {setupStatus}
      <h1 className="flex items-center gap-2 text-2xl font-bold">
        <CircleCheck
          className="size-6 shrink-0 text-brand"
          aria-hidden="true"
        />
        You&apos;re all set
      </h1>
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
                <ArrowUpRight
                  className="ml-1 inline size-3.5"
                  aria-hidden="true"
                />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              <span className="text-muted-foreground">
                {' '}
                — {site.description}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <Button asChild variant="brand">
        <Link href="/app">
          Go to your dashboard
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    </>
  )
}
