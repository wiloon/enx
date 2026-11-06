import { SIGNED_OUT_MESSAGE } from '@/lib/signedOut'

// The signed-out state (#236) in the word popup and a side-panel row: amber,
// with a Sign in that starts the ADR-020 web sign-in.
export default function SignedOutNotice({
  testId,
  onSignIn,
  className = '',
}: {
  testId: string
  onSignIn: () => void
  className?: string
}) {
  return (
    <div
      data-testid={testId}
      className={`flex items-center justify-between gap-2 rounded-sm border border-warning bg-warning-muted text-warning-foreground ${className}`}
    >
      <span className="flex-1">{SIGNED_OUT_MESSAGE}</span>
      <button
        type="button"
        data-testid={`${testId}-sign-in`}
        onClick={onSignIn}
        className="font-medium whitespace-nowrap underline-offset-2 hover:underline active:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning-foreground rounded-sm"
      >
        Sign in
      </button>
    </div>
  )
}
