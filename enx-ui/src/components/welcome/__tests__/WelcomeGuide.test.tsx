import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import WelcomeGuide from '../WelcomeGuide'
import { apiService } from '@/services/api'
import { useAuth } from '@/hooks/useAuth'
import { setRuntimeEnv } from '@/test/runtimeEnv'

jest.mock('@/services/api', () => ({
  apiService: {
    getPreferences: jest.fn(),
    updatePreferences: jest.fn(),
    getStatsOverview: jest.fn(),
  },
}))

const replace = jest.fn()
const push = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
}))

jest.mock('@/hooks/useAuth', () => ({ useAuth: jest.fn() }))

const mockAuth = useAuth as jest.Mock
const mockPreferences = apiService.getPreferences as jest.Mock
const mockUpdatePreferences = apiService.updatePreferences as jest.Mock
const mockOverview = apiService.getStatsOverview as jest.Mock

const pref = (effective: boolean) => ({
  value: null,
  effective,
  editable: true,
})

function preferences(onboardingCompleted: boolean) {
  return {
    success: true,
    data: {
      aiWordFallback: pref(false),
      aiWordFallbackNoticeAck: pref(false),
      onboardingCompleted: pref(onboardingCompleted),
    },
  }
}

function overview(vocabTotal: number) {
  return {
    success: true,
    data: {
      vocab: { total: vocabTotal, mastered: 0 },
    },
  }
}

let sendMessage: jest.Mock

function installExtension({ isOnToolbar = false } = {}) {
  sendMessage = jest.fn((_id, message, cb) => {
    if (message.type === 'enx:status') {
      cb({ ok: true, version: '1.0.0', isOnToolbar })
    } else {
      cb({ ok: true })
    }
  })
  ;(global as unknown as { chrome?: unknown }).chrome = {
    runtime: { sendMessage },
  }
}

function signedIn() {
  mockAuth.mockReturnValue({ isLoading: false, isAuthenticated: true })
}

// Polls run every 20 ms here instead of every 2 s.
const POLL_MS = 20

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retryDelay: 0 } },
  })
}

function renderGuide(fromInstall = false, client = newClient()) {
  return render(
    <QueryClientProvider client={client}>
      <WelcomeGuide fromInstall={fromInstall} pollMs={POLL_MS} />
    </QueryClientProvider>
  )
}

const step = (title: string | RegExp) =>
  screen.getByText(title).closest('li') as HTMLElement

beforeEach(() => {
  jest.clearAllMocks()
  setRuntimeEnv({
    ENX_EXTENSION_ID: 'test-ext-id',
    ENX_EXTENSION_WEB_STORE_URL: '',
  })
  ;(global as unknown as { chrome?: unknown }).chrome = undefined
  document.documentElement.removeAttribute('data-enx-learning')
  mockAuth.mockReturnValue({ isLoading: false, isAuthenticated: false })
  mockPreferences.mockResolvedValue(preferences(false))
  mockUpdatePreferences.mockResolvedValue(preferences(true))
  mockOverview.mockResolvedValue(overview(0))
})

it('shows a signed-out visitor sign-in and the sample article, and no later steps', async () => {
  renderGuide()

  expect(
    await screen.findByRole('heading', { name: /sign in to get started/i })
  ).toBeInTheDocument()
  // The install step appears once the extension check has answered.
  await screen.findByText('Add Catglish to Chrome')
  expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
    'href',
    '/sign-in?redirect_url=%2Fwelcome'
  )
  expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute(
    'href',
    '/sign-up?redirect_url=%2Fwelcome'
  )
  expect(
    screen.getByRole('heading', { name: 'The Quiet Power of a Short Walk' })
  ).toBeInTheDocument()
  expect(screen.queryByText('Pin the Catglish icon')).not.toBeInTheDocument()
})

it('never flashes the install step at a visitor who has the extension', async () => {
  installExtension()
  renderGuide()

  expect(screen.queryByText('Add Catglish to Chrome')).not.toBeInTheDocument()
  await screen.findByRole('link', { name: 'Sign in' })
  expect(screen.queryByText('Add Catglish to Chrome')).not.toBeInTheDocument()
})

it('brings an installing visitor back to /welcome?src=install after sign-in', async () => {
  renderGuide(true)

  await screen.findByText('Add Catglish to Chrome')
  expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
    'href',
    '/sign-in?redirect_url=%2Fwelcome%3Fsrc%3Dinstall'
  )
})

it('offers a disabled install button while the store link is not set', async () => {
  renderGuide()

  const button = await screen.findByRole('button', {
    name: 'Coming soon to the Chrome Web Store',
  })
  expect(button).toBeDisabled()
})

it('links the install button to the store once the link is set', async () => {
  setRuntimeEnv({
    ENX_EXTENSION_ID: 'test-ext-id',
    ENX_EXTENSION_WEB_STORE_URL: 'https://chromewebstore.google.com/detail/x',
  })
  renderGuide()

  expect(
    await screen.findByRole('link', { name: 'Add to Chrome' })
  ).toHaveAttribute('href', 'https://chromewebstore.google.com/detail/x')
})

it('ticks sign-in for a signed-in new user and never enables learning mode itself', async () => {
  signedIn()
  installExtension()
  renderGuide(true)

  await waitFor(() =>
    expect(within(step('Sign in')).getByLabelText('Done')).toBeInTheDocument()
  )
  expect(screen.getByText('Pin the Catglish icon')).toBeInTheDocument()
  expect(sendMessage).toHaveBeenCalledWith(
    'test-ext-id',
    { type: 'enx:status' },
    expect.any(Function)
  )
  expect(sendMessage).not.toHaveBeenCalledWith(
    'test-ext-id',
    expect.objectContaining({ type: 'enx:enable-reader' }),
    expect.any(Function)
  )
})

it('ticks the pin step from enx:status', async () => {
  signedIn()
  installExtension({ isOnToolbar: true })
  renderGuide()

  await waitFor(() =>
    expect(
      within(step('Pin the Catglish icon')).getByLabelText('Done')
    ).toBeInTheDocument()
  )
})

it('lets the user skip pinning', async () => {
  signedIn()
  installExtension()
  renderGuide()

  fireEvent.click(await screen.findByRole('button', { name: 'Skip' }))

  expect(
    within(step('Pin the Catglish icon')).getByLabelText('Skipped')
  ).toBeInTheDocument()
})

const statusCalls = () =>
  sendMessage.mock.calls.filter(([, message]) => message.type === 'enx:status')
    .length

const settle = () => new Promise((resolve) => setTimeout(resolve, POLL_MS * 5))

it('stops asking the extension for its status once the pin step is skipped', async () => {
  signedIn()
  installExtension()
  renderGuide()

  fireEvent.click(await screen.findByRole('button', { name: 'Skip' }))
  await settle()
  const afterSkip = statusCalls()
  await settle()

  expect(statusCalls()).toBe(afterSkip)
})

it('does not poll the extension on the finished page', async () => {
  signedIn()
  installExtension()
  mockOverview.mockResolvedValue(overview(12))
  renderGuide()

  await screen.findByRole('heading', { name: "You're all set" })
  await settle()
  const onArrival = statusCalls()
  await settle()

  expect(statusCalls()).toBe(onArrival)
})

it('ticks "Read with Catglish" when the extension marks the page', async () => {
  signedIn()
  installExtension()
  renderGuide()

  const enable = await screen.findByText(/then Read with Catglish/)
  expect(
    within(enable.closest('li') as HTMLElement).queryByLabelText('Done')
  ).not.toBeInTheDocument()

  act(() => {
    document.documentElement.setAttribute('data-enx-learning', 'on')
  })

  await waitFor(() =>
    expect(
      within(step(/then Read with Catglish/)).getByLabelText('Done')
    ).toBeInTheDocument()
  )
})

it('finishes once learning mode is on and a word is looked up, and records it', async () => {
  signedIn()
  // Not pinned and not skipped: pinning never gates finishing.
  installExtension()
  // New user on arrival; the lookup lands while they are on the page.
  mockOverview.mockResolvedValueOnce(overview(0)).mockResolvedValue(overview(1))
  document.documentElement.setAttribute('data-enx-learning', 'on')
  renderGuide(true)

  expect(
    await screen.findByRole('heading', { name: "You're all set" })
  ).toBeInTheDocument()
  expect(mockUpdatePreferences).toHaveBeenCalledWith({
    onboardingCompleted: true,
  })
  // A new user who just finished stays here, even though they arrived from
  // an install and now have a lookup.
  expect(replace).not.toHaveBeenCalled()
})

it('stays finished when learning mode is turned off afterwards', async () => {
  signedIn()
  installExtension({ isOnToolbar: true })
  mockOverview.mockResolvedValueOnce(overview(0)).mockResolvedValue(overview(1))
  document.documentElement.setAttribute('data-enx-learning', 'on')
  renderGuide()

  await screen.findByRole('heading', { name: "You're all set" })
  // Async act: the attribute change reaches React through a MutationObserver
  // callback, which runs after the synchronous part of act has returned.
  await act(async () => {
    document.documentElement.removeAttribute('data-enx-learning')
  })

  await new Promise((resolve) => setTimeout(resolve, POLL_MS * 3))
  expect(
    screen.getByRole('heading', { name: "You're all set" })
  ).toBeInTheDocument()
})

it('tries once more when recording the finish fails', async () => {
  signedIn()
  installExtension()
  mockOverview.mockResolvedValueOnce(overview(0)).mockResolvedValue(overview(1))
  mockUpdatePreferences
    .mockResolvedValueOnce({ success: false, error: 'Network error' })
    .mockResolvedValue(preferences(true))
  document.documentElement.setAttribute('data-enx-learning', 'on')
  renderGuide()

  await screen.findByRole('heading', { name: "You're all set" })
  await waitFor(() => expect(mockUpdatePreferences).toHaveBeenCalledTimes(2))
})

it('shows the finished page on a later visit in the same session after "Skip setup"', async () => {
  signedIn()
  installExtension()
  // Like the server: once written, the flag reads back as set.
  mockUpdatePreferences.mockImplementation(async () => {
    mockPreferences.mockResolvedValue(preferences(true))
    return preferences(true)
  })
  const client = newClient()
  const first = renderGuide(false, client)

  fireEvent.click(await screen.findByRole('button', { name: 'Skip setup' }))
  await waitFor(() => expect(push).toHaveBeenCalledWith('/app'))
  first.unmount()

  renderGuide(false, client)

  expect(
    await screen.findByRole('heading', { name: "You're all set" })
  ).toBeInTheDocument()
})

it('shows a returning user who opens /welcome the finished page with recommended sites', async () => {
  signedIn()
  installExtension({ isOnToolbar: true })
  mockOverview.mockResolvedValue(overview(12))
  renderGuide(false)

  expect(
    await screen.findByRole('heading', { name: "You're all set" })
  ).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Wikipedia/ })).toHaveAttribute(
    'target',
    '_blank'
  )
  expect(screen.queryByText('Pin the Catglish icon')).not.toBeInTheDocument()
})

it('sends a returning user who just installed straight to /app', async () => {
  signedIn()
  installExtension()
  mockPreferences.mockResolvedValue(preferences(true))
  renderGuide(true)

  await waitFor(() => expect(replace).toHaveBeenCalledWith('/app'))
})

it('offers "Skip setup" while the user\'s history is still loading', async () => {
  signedIn()
  installExtension()
  mockPreferences.mockReturnValue(new Promise(() => {}))
  renderGuide()

  expect(
    await screen.findByRole('button', { name: 'Skip setup' })
  ).toBeInTheDocument()
})

it('records "Skip setup" and goes to /app', async () => {
  signedIn()
  installExtension()
  renderGuide()

  fireEvent.click(await screen.findByRole('button', { name: 'Skip setup' }))

  await waitFor(() =>
    expect(mockUpdatePreferences).toHaveBeenCalledWith({
      onboardingCompleted: true,
    })
  )
  expect(push).toHaveBeenCalledWith('/app')
})
