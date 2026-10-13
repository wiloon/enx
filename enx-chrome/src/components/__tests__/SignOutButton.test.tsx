import { act, fireEvent, render, screen } from '@testing-library/react'
import { Provider } from 'jotai'
import { useSyncExternalStore } from 'react'

// A fake Clerk session the components subscribe to. Like clerk-js, signOut()
// clears the user first (useUser then reports isLoaded: false) and only
// settles on "signed out" once the server call has returned.
type Session = { isLoaded: boolean; isSignedIn: boolean }
let session: Session = { isLoaded: true, isSignedIn: true }
const listeners = new Set<() => void>()
function setSession(next: Session) {
  session = next
  listeners.forEach(l => l())
}
let finishSignOut: () => void = () => {}
const mockSignOut = jest.fn((_callback?: unknown) => {
  setSession({ isLoaded: false, isSignedIn: false })
  return new Promise<void>(resolve => {
    finishSignOut = () => {
      setSession({ isLoaded: true, isSignedIn: false })
      resolve()
    }
  })
})

jest.mock('@clerk/chrome-extension', () => ({
  useUser: () =>
    useSyncExternalStore(
      l => {
        listeners.add(l)
        return () => listeners.delete(l)
      },
      () => session
    ),
  useClerk: () => ({ signOut: mockSignOut }),
}))

// CatglishLogo pulls in an asset import Jest can't load.
jest.mock('@/components/CatglishLogo', () => () => null)

import Login from '../Login'
import SignOutButton from '../SignOutButton'

function renderPopup() {
  return render(
    <Provider>
      <Login>
        <SignOutButton />
      </Login>
    </Provider>
  )
}

describe('SignOutButton', () => {
  beforeEach(() => {
    session = { isLoaded: true, isSignedIn: true }
    mockSignOut.mockClear()
  })

  it('signs out without navigating, so the popup does not reload', () => {
    renderPopup()

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(mockSignOut).toHaveBeenCalledTimes(1)
    // A callback instead of a redirectUrl: clerk-js then skips its navigate().
    expect(typeof mockSignOut.mock.calls[0][0]).toBe('function')
  })

  it('says "Signing out…" rather than "Loading…" while the sign-out runs', () => {
    renderPopup()

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(screen.getByText('Signing out…')).toBeInTheDocument()
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
  })

  it('shows the sign-in card once the sign-out has finished', async () => {
    renderPopup()

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await act(async () => finishSignOut())

    expect(screen.queryByText('Signing out…')).not.toBeInTheDocument()
    expect(screen.getByText('Sign in to Catglish')).toBeInTheDocument()
  })
})
