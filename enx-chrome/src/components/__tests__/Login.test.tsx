import { fireEvent, render, screen } from '@testing-library/react'
import { Provider } from 'jotai'
import Login from '@/components/Login'

jest.mock('@/lib/auth', () => ({
  useAuthSession: jest.fn(),
}))

import { useAuthSession } from '@/lib/auth'

const auth = useAuthSession as jest.MockedFunction<typeof useAuthSession>

const renderLogin = (ui: React.ReactElement) =>
  render(<Provider>{ui}</Provider>)

describe('Login', () => {
  beforeEach(() => {
    auth.mockReturnValue({
      isLoaded: true,
      isSignedIn: false,
      user: null,
    } as ReturnType<typeof useAuthSession>)
  })

  it('renders beforeSignIn above the sign-in card when signed out', () => {
    renderLogin(
      <Login beforeSignIn={<button type="button">Read with Catglish</button>}>
        <div>signed in body</div>
      </Login>
    )

    expect(
      screen.getByRole('button', { name: 'Read with Catglish' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Sign in to Catglish' })
    ).toBeInTheDocument()
    expect(screen.queryByText('signed in body')).not.toBeInTheDocument()
  })

  it('omits beforeSignIn when signed in', () => {
    auth.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      user: { fullName: 'Ada' },
    } as ReturnType<typeof useAuthSession>)

    renderLogin(
      <Login beforeSignIn={<button type="button">Read with Catglish</button>}>
        <div>signed in body</div>
      </Login>
    )

    expect(
      screen.queryByRole('button', { name: 'Read with Catglish' })
    ).not.toBeInTheDocument()
    expect(screen.getByText('signed in body')).toBeInTheDocument()
  })

  it('asks the background to open sign-in on the website', () => {
    const sendMessage = chrome.runtime.sendMessage as jest.Mock
    sendMessage.mockReset()
    sendMessage.mockResolvedValue(undefined)

    renderLogin(
      <Login>
        <div>signed in body</div>
      </Login>
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Sign in on the website' })
    )

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith({ action: 'openWebSignIn' })
  })
})
