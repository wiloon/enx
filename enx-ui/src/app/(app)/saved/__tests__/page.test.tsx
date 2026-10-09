import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SavedPagesPage from '../page'
import { apiService } from '@/services/api'

jest.mock('@/services/api', () => ({
  apiService: { listSavedPages: jest.fn(), deleteSavedPage: jest.fn() },
}))

const mockList = apiService.listSavedPages as jest.Mock
const mockDelete = apiService.deleteSavedPage as jest.Mock

const pages = [
  {
    id: 'p2',
    url: 'https://wiloon.com/why-we-forget-what-we-read',
    title: 'Why We Forget What We Read',
    host: 'wiloon.com',
    createdAt: '2026-10-08T12:00:00Z',
  },
  {
    id: 'p1',
    url: 'https://example.com/untitled',
    title: '',
    host: 'example.com',
    createdAt: '2026-10-07T12:00:00Z',
  },
]

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SavedPagesPage />
    </QueryClientProvider>
  )
}

beforeEach(() => jest.clearAllMocks())

it('links each saved page to its address in a new tab, falling back to the URL without a title', async () => {
  mockList.mockResolvedValue({ success: true, data: { pages } })
  renderPage()

  const titled = await screen.findByRole('link', {
    name: /Why We Forget What We Read/,
  })
  expect(titled).toHaveAttribute('href', pages[0].url)
  expect(titled).toHaveAttribute('target', '_blank')
  expect(
    screen.getByRole('link', { name: /example\.com\/untitled/ })
  ).toHaveAttribute('href', pages[1].url)
})

it('removes a page from the list once it is deleted', async () => {
  mockList.mockResolvedValue({ success: true, data: { pages } })
  mockDelete.mockResolvedValue({ success: true, data: { success: true } })
  renderPage()

  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Delete Why We Forget What We Read',
    })
  )

  await waitFor(() =>
    expect(
      screen.queryByRole('link', { name: /Why We Forget What We Read/ })
    ).not.toBeInTheDocument()
  )
  expect(mockDelete).toHaveBeenCalledWith('p2')
})

it('keeps the page and shows the error when deleting fails', async () => {
  mockList.mockResolvedValue({ success: true, data: { pages } })
  mockDelete.mockResolvedValue({
    success: false,
    error: 'could not delete the page',
  })
  renderPage()

  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Delete Why We Forget What We Read',
    })
  )

  expect(
    await screen.findByText('could not delete the page')
  ).toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: /Why We Forget What We Read/ })
  ).toBeInTheDocument()
})

it('explains how to save a page when there are none', async () => {
  mockList.mockResolvedValue({ success: true, data: { pages: [] } })
  renderPage()
  expect(await screen.findByText(/No saved pages yet/)).toBeInTheDocument()
})
