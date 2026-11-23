import { useAuthSignOut } from '@/lib/auth'
import { sendRuntimeMessage } from '@/lib/extensionContext'
import { signingOutAtom } from '@/store/atoms'
import { ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline'
import { useSetAtom } from 'jotai'

/**
 * The popup's sign-out button.
 *
 * Passing signOut() a callback skips navigation that would reload popup.html
 * and force the auth SDK to start over. The session updates in place and
 * <Login> re-renders signed out.
 */
export default function SignOutButton() {
  const signOut = useAuthSignOut()
  const setSigningOut = useSetAtom(signingOutAtom)

  const handleClick = async () => {
    setSigningOut(true)
    try {
      await signOut(() => {})
      await sendRuntimeMessage({ type: 'accountSignedOut' })
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
