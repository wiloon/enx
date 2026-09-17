import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AppHome from '../page'
import { apiService } from '@/services/api'
import { useExtensionStatus } from '@/hooks/useExtensionStatus'

jest.mock('@/services/api', () => ({
  apiService: {
    listReaderDocuments: jest.fn(),
    getReaderDocument: jest.fn(),
    getBillingMe: jest.fn(),
  },
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { username: 'yue wang' } }),
}))

jest.mock('@/hooks/useExtensionStatus', () => ({
  useExtensionStatus: jest.fn(),
}))

const mockList = apiService.listReaderDocuments as jest.Mock
const mockBilling = apiService.getBillingMe as jest.Mock
const mockExtensionStatus = useExtensionStatus as jest.Mock

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AppHome />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockExtensionStatus.mockReturnValue('installed')
  mockBilling.mockResolvedValue({
    success: true,
    data: {
      subscription: { status: 'active', plan: 'pro', currentPeriodEnd: 0 },
      credits: { subscriptionBalance: 1000, topupBalance: 240 },
    },
  })
})

it('walks a user with no data through the three onboarding steps', async () => {
  mockList.mockResolvedValue({ success: true, data: { documents: [] } })

  renderPage()

  expect(await screen.findByText('Get started in three steps')).toBeInTheDocument()
  expect(screen.getByText('Catglish is installed')).toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: 'Paste some text instead' })
  ).toBeInTheDocument()
  expect(screen.queryByText('Continue reading')).not.toBeInTheDocument()
})

it('shows the workbench with saved documents once there is data', async () => {
  mockList.mockResolvedValue({
    success: true,
    data: {
      documents: [
        {
          id: 'doc-1',
          createdAt: '2026-09-15T00:00:00Z',
          updatedAt: new Date().toISOString(),
          preview: 'An article about sea otters',
        },
      ],
    },
  })

  renderPage()

  expect(
    await screen.findByText('An article about sea otters')
  ).toBeInTheDocument()
  expect(screen.getByText('Continue reading')).toBeInTheDocument()
  expect(screen.queryByText('Get started in three steps')).not.toBeInTheDocument()
})

it('renders feature entries as links, not buttons (ADR-027 decision 2)', async () => {
  mockList.mockResolvedValue({ success: true, data: { documents: [] } })

  renderPage()

  for (const label of ['Word Lookup', 'Rephrase', 'Reader']) {
    const tile = await screen.findByRole('link', { name: label })
    expect(tile.tagName).toBe('A')
  }
  expect(screen.queryByRole('button', { name: /Go to/ })).not.toBeInTheDocument()
})

it('hides the plan card when billing fails instead of taking the page down', async () => {
  mockList.mockResolvedValue({
    success: true,
    data: {
      documents: [
        {
          id: 'doc-1',
          createdAt: '2026-09-15T00:00:00Z',
          updatedAt: new Date().toISOString(),
          preview: 'An article',
        },
      ],
    },
  })
  mockBilling.mockResolvedValue({ success: false, error: 'boom' })

  renderPage()

  expect(await screen.findByText('Continue reading')).toBeInTheDocument()
  await waitFor(() =>
    expect(screen.queryByText(/credits/)).not.toBeInTheDocument()
  )
})

it('keeps the document list failure inside its own block', async () => {
  mockList.mockResolvedValue({ success: false, error: 'boom' })

  renderPage()

  expect(
    await screen.findByText("Couldn't load your documents.")
  ).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Reader' })).toBeInTheDocument()
})

it('offers the install banner only when the extension is missing', async () => {
  mockList.mockResolvedValue({ success: true, data: { documents: [] } })
  mockExtensionStatus.mockReturnValue('not-installed')

  renderPage()

  expect(
    await screen.findByText(/Add Catglish to Chrome to look up words/)
  ).toBeInTheDocument()
})
