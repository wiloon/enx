import { signingOutAtom } from '@/store/atoms'
import { useClerk } from '@clerk/chrome-extension'
import { ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline'
import { useSetAtom } from 'jotai'

/**
 * The popup's sign-out button.
 *
 * Clerk's <SignOutButton> navigates to its redirectUrl after signing out,
 * which reloads popup.html and makes Clerk start over: reload clerk-js, then
 * fetch the environment and client from the Frontend API again before the
 * sign-in card can show. Passing signOut() a callback skips that navigation;
 * Clerk updates the session in place and <Login> re-renders signed out.
 */
export default function SignOutButton() {
  const clerk = useClerk()
  const setSigningOut = useSetAtom(signingOutAtom)

  const handleClick = async () => {
    setSigningOut(true)
    try {
      await clerk.signOut(() => {})
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <button
      type="button"
      title="Sign out"
      aria-label="Sign out"
      onClick={() => void handleClick()}
      className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
    >
      <ArrowRightOnRectangleIcon className="h-[18px] w-[18px]" />
    </button>
  )
}
