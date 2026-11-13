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
  screen
    .getByText(title, { selector: 'li > div > p' })
    .closest('li') as HTMLElement

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

it('shows signed-out pinned visitors one complete list with only sign-in expanded', async () => {
  installExtension({ isOnToolbar: true })
  renderGuide()

  await screen.findByRole('link', { name: 'Sign in' })
  expect(
    within(step('Catglish extension installed')).getByLabelText('Done')
  ).toBeInTheDocument()
  expect(screen.getAllByRole('listitem')).toHaveLength(5)
  expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
    'href',
    '/sign-in?redirect_url=%2Fwelcome'
  )
  expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute(
    'href',
    '/sign-up?redirect_url=%2Fwelcome'
  )
  expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument()
  expect(
    screen.queryByRole('img', { name: /Chrome toolbar/ })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Next: finish setup' })
  ).not.toBeInTheDocument()
  for (const title of ['Turn on Catglish', 'Click any word in the article']) {
    expect(within(step(title)).getByLabelText('To do')).toBeInTheDocument()
    expect(within(step(title)).queryByRole('button')).not.toBeInTheDocument()
  }
})

it.each([true, false])(
  'hides the article and welcomes signed-out visitors (installed: %s)',
  async (installed) => {
    if (installed) installExtension()
    renderGuide()
    await screen.findByText(
      installed ? 'Catglish extension installed' : 'Add Catglish to Chrome'
    )
    expect(
      screen.getByRole('heading', { name: 'Welcome to Catglish' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'Sample article' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'The Quiet Power of a Short Walk' })
    ).not.toBeInTheDocument()
  }
)

it('hides the article until authentication is resolved', async () => {
  mockAuth.mockReturnValue({ isLoading: true, isAuthenticated: false })
  await act(async () => {
    renderGuide()
  })
  expect(
    screen.queryByRole('region', { name: 'Sample article' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('heading', { name: 'The Quiet Power of a Short Walk' })
  ).not.toBeInTheDocument()
})

it('expands only installation for a signed-out visitor without the extension', async () => {
  setRuntimeEnv({
    ENX_EXTENSION_ID: 'test-ext-id',
    ENX_EXTENSION_WEB_STORE_URL: 'https://chromewebstore.google.com/detail/x',
  })
  renderGuide()
  await screen.findByRole('link', { name: 'Add to Chrome' })
  expect(screen.getAllByRole('listitem')).toHaveLength(5)
  expect(
    within(step('Add Catglish to Chrome')).getByLabelText('Current step')
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('link', { name: 'Sign in' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('link', { name: 'Sign up' })
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument()
})

it('never flashes the install step at a visitor who has the extension', async () => {
  installExtension({ isOnToolbar: true })
  renderGuide()

  expect(screen.queryByText('Add Catglish to Chrome')).not.toBeInTheDocument()
  await screen.findByRole('link', { name: 'Sign in' })
  expect(screen.queryByText('Add Catglish to Chrome')).not.toBeInTheDocument()
})

it('brings an installing visitor back to /welcome?src=install after sign-in', async () => {
  installExtension({ isOnToolbar: true })
  renderGuide(true)

  await screen.findByRole('link', { name: 'Sign in' })
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
  expect(
    screen.getByRole('region', { name: 'Sample article' })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('heading', { name: 'The Quiet Power of a Short Walk' })
  ).toBeInTheDocument()
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

it('advances a signed-out visitor from Pin to sign-in when the toolbar status changes', async () => {
  installExtension()
  renderGuide()

  await screen.findByRole('button', { name: 'Skip' })
  expect(
    screen.queryByRole('link', { name: 'Sign in' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('link', { name: 'Sign up' })
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('img', { name: /Chrome toolbar/ })
  ).toBeInTheDocument()
  sendMessage.mockImplementation((_id, _message, cb) =>
    cb({ ok: true, isOnToolbar: true })
  )

  await screen.findByRole('link', { name: 'Sign in' })
  expect(screen.getByRole('link', { name: 'Sign up' })).toBeInTheDocument()
  expect(
    within(step('Pin the Catglish icon')).getByLabelText('Done')
  ).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument()
  expect(
    screen.queryByRole('img', { name: /Chrome toolbar/ })
  ).not.toBeInTheDocument()
})

it('advances a signed-out visitor to sign-in and stops polling after skipping Pin', async () => {
  installExtension()
  renderGuide()

  fireEvent.click(await screen.findByRole('button', { name: 'Skip' }))
  expect(
    await screen.findByRole('link', { name: 'Sign in' })
  ).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Sign up' })).toBeInTheDocument()
  expect(
    within(step('Pin the Catglish icon')).getByLabelText('Skipped')
  ).toBeInTheDocument()
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

  const enable = await screen.findByText('Turn on Catglish')
  expect(
    within(enable.closest('li') as HTMLElement).queryByLabelText('Done')
  ).not.toBeInTheDocument()

  act(() => {
    document.documentElement.setAttribute('data-enx-learning', 'on')
  })

  await waitFor(() =>
    expect(
      within(step('Turn on Catglish')).getByLabelText('Done')
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
  expect(
    screen.getByRole('region', { name: 'Sample article' })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('heading', { name: 'The Quiet Power of a Short Walk' })
  ).toBeInTheDocument()
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
  expect(screen.getByRole('link', { name: /Standard Ebooks/ })).toHaveAttribute(
    'target',
    '_blank'
  )
  expect(screen.queryByText('Pin the Catglish icon')).not.toBeInTheDocument()
  expect(
    screen.getByRole('region', { name: 'Sample article' })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('heading', { name: 'The Quiet Power of a Short Walk' })
  ).toBeInTheDocument()
})

it('recommends Standard Ebooks, not BBC News or Wikipedia, once finished', async () => {
  signedIn()
  installExtension({ isOnToolbar: true })
  mockOverview.mockResolvedValue(overview(12))
  renderGuide(false)

  await screen.findByRole('heading', { name: "You're all set" })
  expect(screen.getByRole('link', { name: /Standard Ebooks/ })).toHaveAttribute(
    'href',
    expect.stringMatching(/^https:\/\/standardebooks\.org\//)
  )
  expect(
    screen.queryByRole('link', { name: /BBC News/ })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('link', { name: /Wikipedia/ })
  ).not.toBeInTheDocument()
})

it('sends a returning user who just installed straight to /app', async () => {
  signedIn()
  installExtension()
  mockPreferences.mockResolvedValue(preferences(true))
  renderGuide(true)

  await waitFor(() => expect(replace).toHaveBeenCalledWith('/app'))
})

it.each(['preferences', 'stats'])(
  'offers Skip setup without the article while %s is loading',
  async (pending) => {
    signedIn()
    installExtension()
    const request = pending === 'preferences' ? mockPreferences : mockOverview
    request.mockReturnValue(new Promise(() => {}))
    renderGuide()

    expect(
      await screen.findByRole('button', { name: 'Skip setup' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'Sample article' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'The Quiet Power of a Short Walk' })
    ).not.toBeInTheDocument()
  }
)

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

it('shows a checking status while extension detection is pending, without guessing the install state', async () => {
  signedIn()
  ;(global as unknown as { chrome?: unknown }).chrome = {
    runtime: { sendMessage: jest.fn() },
  }
  renderGuide()
  expect(
    await screen.findByRole('status', { name: 'Checking extension' })
  ).toHaveTextContent('Checking extension…')
  expect(
    screen.queryByRole('link', { name: 'Add to Chrome' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByText('Catglish extension installed')
  ).not.toBeInTheDocument()
})

it('rechecks after installation and replaces the install link with the completed status', async () => {
  signedIn()
  setRuntimeEnv({
    ENX_EXTENSION_ID: 'test-ext-id',
    ENX_EXTENSION_WEB_STORE_URL:
      'https://chromewebstore.google.com/detail/catglish',
  })
  renderGuide()
  await screen.findByRole('link', { name: 'Add to Chrome' })
  installExtension()
  expect(
    await screen.findByText('Catglish extension installed')
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('link', { name: 'Add to Chrome' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Next: finish setup' })
  ).not.toBeInTheDocument()
})

it('offers manual installation and the caution note beside the missing-extension store button', async () => {
  setRuntimeEnv({
    ENX_EXTENSION_ID: 'test-ext-id',
    ENX_EXTENSION_WEB_STORE_URL: 'https://chromewebstore.google.com/detail/x',
  })
  renderGuide()
  await screen.findByRole('link', { name: 'Add to Chrome' })
  expect(
    screen.getByText(/With Enhanced protection enabled, Chrome may show/)
  ).toHaveTextContent('To proceed, select “Continue to install”.')
  expect(
    screen.getByRole('link', { name: 'Install manually from a ZIP file' })
  ).toHaveAttribute('href', '/help/install/offline')
  expect(
    screen.getByRole('link', { name: 'Install manually from a ZIP file' })
  ).toHaveAttribute('target', '_blank')
})

it('removes installation guidance once the extension is detected', async () => {
  setRuntimeEnv({
    ENX_EXTENSION_ID: 'test-ext-id',
    ENX_EXTENSION_WEB_STORE_URL: 'https://chromewebstore.google.com/detail/x',
  })
  renderGuide()
  await screen.findByRole('link', { name: 'Install manually from a ZIP file' })
  installExtension()
  await waitFor(() =>
    expect(
      screen.queryByRole('link', { name: 'Install manually from a ZIP file' })
    ).not.toBeInTheDocument()
  )
  expect(
    screen.queryByText(/With Enhanced protection enabled/)
  ).not.toBeInTheDocument()
})

it.each([
  ['Add Catglish to Chrome', false, false, false, false],
  ['Pin the Catglish icon', true, false, false, false],
  ['Sign in', true, true, false, false],
  ['Turn on Catglish', true, true, true, false],
  ['Click any word in the article', true, true, true, true],
] as const)(
  'marks only %s as the current step',
  async (title, installed, pinned, authenticated, learning) => {
    if (installed) installExtension({ isOnToolbar: pinned })
    if (authenticated) signedIn()
    if (learning)
      document.documentElement.setAttribute('data-enx-learning', 'on')
    const { container } = renderGuide()
    await waitFor(() =>
      expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(
        1
      )
    )
    const current = step(title)
    expect(current).toHaveAttribute('aria-current', 'step')
    expect(
      within(current).getByLabelText('Current step').querySelector('svg')
    ).toHaveClass('lucide-circle-dot', 'text-brand')
    expect(within(current).getByText(title, { selector: 'p' })).toHaveClass(
      'font-medium',
      'text-foreground'
    )
    for (const row of container.querySelectorAll('ol > li')) {
      if (row !== current) expect(row).not.toHaveAttribute('aria-current')
    }
  }
)

it('expands enable, then moves the detail and marker to look-up when enabled', async () => {
  signedIn()
  installExtension({ isOnToolbar: true })
  const { container } = renderGuide()
  const hint = await screen.findByText(
    'Click the Catglish icon in your toolbar, then Read with Catglish.'
  )
  expect(hint.parentElement).toHaveTextContent('↗')
  const lookup = step('Click any word in the article')
  expect(
    within(lookup).getByLabelText('To do').querySelector('svg')
  ).toHaveClass('lucide-circle', 'text-muted-foreground')
  expect(within(lookup).getByText('Click any word in the article')).toHaveClass(
    'text-muted-foreground'
  )
  expect(within(lookup).queryByText(/Try any word/)).not.toBeInTheDocument()

  act(() => document.documentElement.setAttribute('data-enx-learning', 'on'))
  await waitFor(() => expect(lookup).toHaveAttribute('aria-current', 'step'))
  expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1)
  expect(
    within(step('Turn on Catglish')).getByLabelText('Done').querySelector('svg')
  ).toHaveClass('lucide-check', 'text-brand')
  expect(
    screen.queryByText(/Click the Catglish icon in your toolbar, then/)
  ).not.toBeInTheDocument()
  expect(
    within(lookup).getByText('Try any word in the article on the right →')
  ).toBeInTheDocument()
  expect(
    within(lookup).getByText('Try any word in the article below ↓')
  ).toBeInTheDocument()
})

it('ends the finished view with a brand dashboard link and decorative arrow', async () => {
  signedIn()
  mockOverview.mockResolvedValue(overview(12))
  renderGuide(false)
  await screen.findByRole('heading', { name: "You're all set" })
  const dashboard = screen.getByRole('link', {
    name: 'Go to your dashboard',
  })
  expect(dashboard).toHaveAttribute('href', '/app')
  expect(dashboard).toHaveClass('bg-brand', 'text-brand-foreground')
  expect(dashboard.lastElementChild).toHaveClass('lucide-arrow-right')
  expect(dashboard.lastElementChild).toHaveAttribute('aria-hidden', 'true')
  expect(dashboard.nextElementSibling).toBeNull()
})

it('marks completion before the unchanged heading with a decorative brand check', async () => {
  signedIn()
  mockOverview.mockResolvedValue(overview(12))
  renderGuide(false)
  const heading = await screen.findByRole('heading', {
    name: "You're all set",
  })
  expect(heading.firstElementChild).toHaveClass(
    'lucide-circle-check',
    'text-brand'
  )
  expect(heading.firstElementChild).toHaveAttribute('aria-hidden', 'true')
})

it('announces a new tab and shows a decorative up-right arrow for every recommended site', async () => {
  signedIn()
  mockOverview.mockResolvedValue(overview(12))
  renderGuide(false)
  await screen.findByRole('heading', { name: "You're all set" })
  for (const name of [
    'InfoQ',
    'Anthropic News',
    'The Guardian',
    'AP News',
    'NPR',
    'Standard Ebooks',
  ]) {
    const link = screen.getByRole('link', {
      name: `${name} (opens in a new tab)`,
    })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveClass('text-brand')
    expect(link.querySelector('svg')).toHaveClass('lucide-arrow-up-right')
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  }
})

it('has no current step after the guide is finished', async () => {
  signedIn()
  mockOverview.mockResolvedValue(overview(1))
  const { container } = renderGuide()
  await screen.findByRole('heading', { name: "You're all set" })
  expect(container.querySelector('[aria-current]')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Current step')).not.toBeInTheDocument()
})
