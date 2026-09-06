import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import RephrasePage from '../page'
import { apiService } from '@/services/api'

jest.mock('@/services/api', () => ({
  apiService: { rephrase: jest.fn() },
}))

const mockRephrase = apiService.rephrase as jest.Mock

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <RephrasePage />
    </QueryClientProvider>
  )
}

const okData = {
  idiomatic: 'Could you review this when you get a chance?',
  alternatives: [{ text: 'Mind reviewing this?', register: 'casual (Slack)' }],
  notes: ['用 when you get a chance 弱化催促。'],
}

beforeEach(() => {
  jest.clearAllMocks()
})

it('disables submit until there is input', () => {
  renderPage()
  const button = screen.getByRole('button', { name: 'Rephrase' })
  expect(button).toBeDisabled()

  fireEvent.change(screen.getByLabelText(/Type in Chinese or rough English/i), {
    target: { value: '帮我看下这个' },
  })
  expect(button).toBeEnabled()
})

it('blocks submission when the input exceeds 200 characters', () => {
  renderPage()
  fireEvent.change(screen.getByLabelText(/Type in Chinese or rough English/i), {
    target: { value: '字'.repeat(201) },
  })

  expect(screen.getByText('201 / 200')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Rephrase' })).toBeDisabled()
  expect(mockRephrase).not.toHaveBeenCalled()
})

it('allows exactly 200 characters', () => {
  renderPage()
  fireEvent.change(screen.getByLabelText(/Type in Chinese or rough English/i), {
    target: { value: '字'.repeat(200) },
  })
  expect(screen.getByRole('button', { name: 'Rephrase' })).toBeEnabled()
})

it('submits the trimmed input and renders the idiomatic rendering, alternatives, and notes', async () => {
  mockRephrase.mockResolvedValue({ success: true, data: okData })
  renderPage()

  fireEvent.change(screen.getByLabelText(/Type in Chinese or rough English/i), {
    target: { value: '  帮我看下这个  ' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Rephrase' }))

  await waitFor(() =>
    expect(
      screen.getByText('Could you review this when you get a chance?')
    ).toBeInTheDocument()
  )
  expect(mockRephrase).toHaveBeenCalledWith('帮我看下这个')
  expect(screen.getByText('Mind reviewing this?')).toBeInTheDocument()
  expect(screen.getByText('casual (Slack)')).toBeInTheDocument()
  expect(
    screen.getByText('用 when you get a chance 弱化催促。')
  ).toBeInTheDocument()
})

it('shows the backend error message when the request fails', async () => {
  mockRephrase.mockResolvedValue({
    success: false,
    error: 'Insufficient credits. Top up or subscribe to continue.',
  })
  renderPage()

  fireEvent.change(screen.getByLabelText(/Type in Chinese or rough English/i), {
    target: { value: '帮我看下这个' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Rephrase' }))

  await waitFor(() =>
    expect(
      screen.getByText('Insufficient credits. Top up or subscribe to continue.')
    ).toBeInTheDocument()
  )
})

it('copies a rendering to the clipboard', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined)
  Object.assign(navigator, { clipboard: { writeText } })
  mockRephrase.mockResolvedValue({ success: true, data: okData })
  renderPage()

  fireEvent.change(screen.getByLabelText(/Type in Chinese or rough English/i), {
    target: { value: '帮我看下这个' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Rephrase' }))
  await waitFor(() =>
    expect(
      screen.getByText('Could you review this when you get a chance?')
    ).toBeInTheDocument()
  )

  fireEvent.click(screen.getAllByRole('button', { name: 'Copy' })[0])
  expect(writeText).toHaveBeenCalledWith(
    'Could you review this when you get a chance?'
  )
})
