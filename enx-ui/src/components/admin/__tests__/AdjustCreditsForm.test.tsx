import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AdjustCreditsForm from '../AdjustCreditsForm'
import { apiService } from '@/services/api'

jest.mock('@/services/api', () => ({
  apiService: {
    adminAdjustCredits: jest.fn(),
  },
}))

const mockAdjust = apiService.adminAdjustCredits as jest.Mock

function renderForm(topupBalance = 20) {
  const onAdjusted = jest.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <AdjustCreditsForm
        email="reader@example.com"
        topupBalance={topupBalance}
        onAdjusted={onAdjusted}
      />
    </QueryClientProvider>
  )
  return { onAdjusted }
}

function fill(amount: string, reason: string) {
  fireEvent.change(screen.getByLabelText('Credits'), {
    target: { value: amount },
  })
  fireEvent.change(screen.getByLabelText('Reason'), {
    target: { value: reason },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAdjust.mockResolvedValue({
    success: true,
    data: { success: true, balance: 605 },
  })
})

// ADR-049 Decision 2.
it('grants credits with the reason and reports the new balance', async () => {
  const { onAdjusted } = renderForm()

  fill('25', ' support comp ')
  fireEvent.click(screen.getByRole('button', { name: 'Grant credits' }))

  expect(await screen.findByRole('status')).toHaveTextContent(
    'Granted 25 credits. New balance: 605.'
  )
  expect(mockAdjust).toHaveBeenCalledWith('grant', {
    email: 'reader@example.com',
    amount: 25,
    reason: 'support comp',
  })
  expect(onAdjusted).toHaveBeenCalled()
  expect(screen.getByLabelText('Credits')).toHaveValue(null)
  expect(screen.getByLabelText('Reason')).toHaveValue('')
})

it('does not send a form without a reason', () => {
  renderForm()

  fill('25', '  ')
  fireEvent.click(screen.getByRole('button', { name: 'Grant credits' }))

  expect(screen.getByRole('alert')).toHaveTextContent('A reason is required.')
  expect(mockAdjust).not.toHaveBeenCalled()
})

// ADR-049 Decision 3: a deduction asks first, and warns when it would push
// the top-up pool below zero.
it('asks before deducting, warning that the top-up balance goes negative', async () => {
  const { onAdjusted } = renderForm(20)

  fill('50', 'chargeback')
  fireEvent.click(screen.getByRole('button', { name: 'Deduct credits' }))

  expect(mockAdjust).not.toHaveBeenCalled()
  expect(
    screen.getByText('Deduct 50 credits from reader@example.com?')
  ).toBeInTheDocument()
  expect(
    screen.getByText('This leaves the top-up balance at -30 credits.')
  ).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Confirm deduction' }))

  expect(await screen.findByRole('status')).toHaveTextContent(
    'Deducted 50 credits. New balance: 605.'
  )
  expect(mockAdjust).toHaveBeenCalledWith('deduct', {
    email: 'reader@example.com',
    amount: 50,
    reason: 'chargeback',
  })
  expect(onAdjusted).toHaveBeenCalled()
})

it('deducts nothing when the admin backs out', () => {
  renderForm(100)

  fill('50', 'chargeback')
  fireEvent.click(screen.getByRole('button', { name: 'Deduct credits' }))
  expect(
    screen.queryByText(/leaves the top-up balance/)
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

  expect(
    screen.queryByRole('button', { name: 'Confirm deduction' })
  ).not.toBeInTheDocument()
  expect(mockAdjust).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Credits')).toHaveValue(50)
})

it('shows the API error and keeps the form filled', async () => {
  mockAdjust.mockResolvedValue({
    success: false,
    error: 'failed to update credits',
  })
  const { onAdjusted } = renderForm()

  fill('25', 'comp')
  fireEvent.click(screen.getByRole('button', { name: 'Grant credits' }))

  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'failed to update credits'
    )
  )
  expect(onAdjusted).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Reason')).toHaveValue('comp')
})
