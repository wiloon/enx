import { useState } from 'react'
import { useAtomValue } from 'jotai'
import { LockClosedIcon, SparklesIcon } from '@heroicons/react/20/solid'
import { billingUrl, stopAutomaticAiLookup } from '@/lib/aiLookup'
import { fetchPreferences } from '@/lib/serverPreferences'
import { aiLookupAtom, aiNoticeAtom } from '@/store/atoms'

// The AI word fallback's pieces of the word popup (ADR-045): what a lookup that
// found nothing offers, the badge on a definition a model wrote, and the
// one-time notice that the word was sent to an AI provider.

const linkClass = 'text-brand hover:underline font-medium'
const buttonClass =
  'inline-flex items-center gap-1 text-sm text-brand hover:text-brand/80 font-medium'

export function AiMissPanel({ onLookup }: { onLookup: () => void }) {
  const state = useAtomValue(aiLookupAtom)

  const lookupButton = (
    <button
      type="button"
      data-testid="word-popover-ai-lookup"
      onClick={onLookup}
      className={buttonClass}
    >
      <SparklesIcon className="h-4 w-4" aria-hidden="true" />
      Look up with AI
    </button>
  )

  switch (state.status) {
    case 'loading':
      return (
        <p
          data-testid="word-popover-ai-loading"
          className="text-sm text-muted-foreground"
          role="status"
        >
          <span className="inline-block animate-spin mr-2">⏳</span>
          Not in the dictionary. Asking AI…
        </p>
      )

    case 'none':
      return (
        <p
          data-testid="word-popover-ai-none"
          className="text-sm text-muted-foreground"
        >
          AI couldn&apos;t define this word.
        </p>
      )

    case 'offer':
      return (
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            Not found in the dictionary.
          </p>
          {state.canUse ? (
            lookupButton
          ) : (
            // Not available to this user yet: the button leads to billing, in a
            // new tab so the page being read stays put. It says so up front.
            <>
              <a
                data-testid="word-popover-ai-upgrade"
                href={billingUrl('lookup-miss')}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass}
              >
                <LockClosedIcon className="h-4 w-4" aria-hidden="true" />
                Look up with AI
              </a>
              <p className="text-xs text-muted-foreground">
                Subscribe or add credit to use AI lookup.
              </p>
            </>
          )}
        </div>
      )

    case 'error':
      return (
        <div data-testid="word-popover-ai-error" className="space-y-1">
          <p className="text-sm text-destructive">
            {state.message || errorMessage(state.reason)}
          </p>
          {(state.reason === 'credit' || state.reason === 'not-entitled') && (
            <a
              href={billingUrl('ai-credit')}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              Subscribe / add credit
            </a>
          )}
          {(state.reason === 'rate-limited' ||
            state.reason === 'unavailable') &&
            lookupButton}
        </div>
      )

    default:
      return (
        <p
          data-testid="word-popover-not-found"
          className="text-sm text-muted-foreground"
        >
          Not found in the dictionary.
        </p>
      )
  }
}

function errorMessage(
  reason: 'credit' | 'rate-limited' | 'not-entitled' | 'unavailable'
): string {
  switch (reason) {
    case 'credit':
      return 'Not enough credit for an AI lookup.'
    case 'rate-limited':
      return 'Too many AI lookups. Try again in a moment.'
    case 'not-entitled':
      return 'AI lookup is available with a subscription or a credit balance.'
    default:
      return "AI lookup isn't available right now."
  }
}

type AutoState = 'loading' | 'on' | 'off' | 'unknown' | 'stopped'

// Marks a definition a model wrote, so the user knows it did not come from the
// dictionary. It is also the permanent way to switch automatic AI lookup off,
// so that is one click from the result and nobody has to find a settings page.
export function AiBadge() {
  const [open, setOpen] = useState(false)
  const [auto, setAuto] = useState<AutoState>('loading')

  // The popup doesn't know the user's setting for a cached definition, so it
  // asks the server when the badge is opened.
  const toggle = async () => {
    const opening = !open
    setOpen(opening)
    if (!opening) return
    setAuto('loading')
    const result = await fetchPreferences()
    setAuto(
      !result.ok
        ? 'unknown'
        : result.data.aiWordFallback.effective
          ? 'on'
          : 'off'
    )
  }

  const stop = async () => {
    setAuto((await stopAutomaticAiLookup()) ? 'stopped' : 'unknown')
  }

  return (
    <span className="relative inline-block">
      <button
        type="button"
        data-testid="word-popover-ai-badge"
        onClick={toggle}
        aria-expanded={open}
        className="inline-flex items-center rounded-sm border border-brand/40 px-1 text-[10px] font-semibold leading-4 text-brand hover:bg-brand-muted"
        title="Defined by AI. Click for options."
      >
        AI
      </button>
      {open && (
        <div
          data-testid="word-popover-ai-menu"
          className="mt-1 space-y-1 rounded-sm border border-border bg-background p-2 text-xs text-muted-foreground"
        >
          <p>This definition was written by AI, not the dictionary.</p>
          {auto === 'loading' && <p>Checking your AI setting…</p>}
          {auto === 'on' && (
            <button
              type="button"
              data-testid="word-popover-ai-stop"
              onClick={stop}
              className="font-medium text-brand hover:underline"
            >
              Stop using AI automatically
            </button>
          )}
          {auto === 'off' && <p>Automatic AI lookup is off.</p>}
          {auto === 'stopped' && (
            <p>
              Automatic AI lookup is off. You can turn it back on in the
              extension options or on the Catglish website.
            </p>
          )}
          {auto === 'unknown' && (
            <p>Couldn&apos;t reach your AI setting. Try again in a moment.</p>
          )}
        </div>
      )}
    </span>
  )
}

// Shown once per account, with the first AI result: the word was sent to an AI
// provider. When the lookup ran by itself it also offers to stop that.
export function AiNotice() {
  const { show, offerStop } = useAtomValue(aiNoticeAtom)
  const [stopped, setStopped] = useState(false)
  if (!show) return null

  return (
    <div
      data-testid="word-popover-ai-notice"
      className="rounded-sm border border-brand/25 bg-brand-muted p-2 text-xs text-brand"
    >
      <p>
        Looked up with AI. Only this word was sent to an AI provider, never the
        sentence or the page.
      </p>
      {offerStop && !stopped && (
        <button
          type="button"
          data-testid="word-popover-ai-notice-stop"
          onClick={async () => {
            if (await stopAutomaticAiLookup()) setStopped(true)
          }}
          className="mt-1 font-medium underline"
        >
          Stop using AI automatically
        </button>
      )}
      {stopped && <p className="mt-1">Automatic AI lookup is off.</p>}
    </div>
  )
}
