import { SIGNED_OUT_MESSAGE } from '@/lib/signedOut'

const ACTION_CLASS =
  'font-medium whitespace-nowrap underline-offset-2 hover:underline active:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning-foreground rounded-sm'

// The signed-out state (#236) in the word popup and a side-panel row: amber,
// with a Sign in that starts the ADR-020 web sign-in. The unverified state
// (#686) passes its own message and a Retry, shown before Sign in.
export default function SignedOutNotice({
  testId,
  onSignIn,
  onRetry,
  message = SIGNED_OUT_MESSAGE,
  className = '',
}: {
  testId: string
  onSignIn: () => void
  onRetry?: () => void
  message?: string
  className?: string
}) {
  return (
    <div
      data-testid={testId}
      className={`flex items-center justify-between gap-2 rounded-sm border border-warning bg-warning-muted text-warning-foreground ${className}`}
    >
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button
          type="button"
          data-testid={`${testId}-retry`}
          onClick={onRetry}
          className={ACTION_CLASS}
        >
          Retry
        </button>
      )}
      <button
        type="button"
        data-testid={`${testId}-sign-in`}
        onClick={onSignIn}
        className={ACTION_CLASS}
      >
        Sign in
      </button>
    </div>
  )
}
