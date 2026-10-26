import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import BillingSupportForm from '../BillingSupportForm'

const mockSubmit = jest.fn()
jest.mock('@/services/api', () => ({
  apiService: {
    submitBillingSupport: (...args: unknown[]) => mockSubmit(...args),
  },
}))

const SENT = {
  success: true,
  data: {
    message: 'Your message was sent to support.',
    supportRequest: { message: 'please help', sentAt: '2026-10-26T08:30:00Z' },
  },
}

const textbox = () => screen.getByRole('textbox')
const button = () => screen.getByRole('button', { name: /^send/i })
const type = (value: string) =>
  fireEvent.change(textbox(), { target: { value } })

beforeEach(() => {
  jest.clearAllMocks()
  mockSubmit.mockResolvedValue(SENT)
})

describe('BillingSupportForm', () => {
  it('groups the borderless message field and controls in one focusable composer surface', () => {
    render(<BillingSupportForm subscriptionId="sub_1" />)
    const composer = textbox().parentElement
    expect(composer).toHaveClass(
      'rounded-xl',
      'border',
      'bg-card',
      'shadow-xs',
      'focus-within:ring-2',
      'focus-within:ring-ring'
    )
    expect(composer).toContainElement(button())
    expect(textbox()).toHaveClass('border-0')
    expect(textbox()).not.toHaveClass(
      'border',
      'shadow-xs',
      'focus-visible:ring-2'
    )
    type('a'.repeat(1800))
    expect(composer).toContainElement(screen.getByText(/1,800 \/ 2,000/))
  })

  it('uses the solid brand style for its primary action', () => {
    render(<BillingSupportForm subscriptionId="sub_1" />)
    expect(button()).toHaveClass('bg-brand', 'text-brand-foreground')
  })

  it('sends the message for its subscription and shows the answer instead of the form', async () => {
    render(<BillingSupportForm subscriptionId="sub_1" />)
    type('please help')
    fireEvent.click(button())

    expect(
      await screen.findByText('Your message was sent to support.')
    ).toBeInTheDocument()
    expect(mockSubmit).toHaveBeenCalledWith('sub_1', 'please help')
    expect(screen.getByText('please help')).toBeInTheDocument()
    expect(
      document.querySelector('time[datetime="2026-10-26T08:30:00Z"]')
    ).not.toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull()
  })

  it('shows the client error and keeps the typed text on failure', async () => {
    mockSubmit.mockResolvedValue({ success: false, error: 'Try again later.' })
    render(<BillingSupportForm subscriptionId="sub_1" />)
    type('please help')
    fireEvent.click(button())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Try again later.')
    expect(alert).toHaveClass('text-destructive')
    expect(textbox()).toHaveValue('please help')
    expect(button()).toBeEnabled()
  })

  it.each([
    ['empty', ''],
    ['whitespace-only', '  \n\t '],
  ])('disables the button for an %s message', (_name, value) => {
    render(<BillingSupportForm subscriptionId="sub_1" />)
    type(value)
    expect(button()).toBeDisabled()
    fireEvent.click(button())
    expect(mockSubmit).not.toHaveBeenCalled()
  })

  it('disables the button past 2000 code points, not at 2000', () => {
    render(<BillingSupportForm subscriptionId="sub_1" />)
    type('😀'.repeat(2000))
    expect(button()).toBeEnabled()
    type('😀'.repeat(2001))
    expect(button()).toBeDisabled()
    expect(screen.getByText(/2,001 \/ 2,000/)).toHaveClass('text-destructive')
  })

  it('shows the counter from 1800 code points only', () => {
    render(<BillingSupportForm subscriptionId="sub_1" />)
    type('a'.repeat(1799))
    expect(screen.queryByText(/\/ 2,000/)).toBeNull()
    type('a'.repeat(1800))
    const counter = screen.getByText(/1,800 \/ 2,000/)
    expect(counter).not.toHaveClass('text-destructive')
  })

  it('sends one request for a double click while in flight', async () => {
    let resolve: (v: unknown) => void = () => {}
    mockSubmit.mockReturnValue(new Promise((r) => (resolve = r)))
    render(<BillingSupportForm subscriptionId="sub_1" />)
    type('please help')
    fireEvent.click(button())
    fireEvent.click(button())

    expect(mockSubmit).toHaveBeenCalledTimes(1)
    expect(button()).toBeDisabled()
    resolve(SENT)
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
  })
})
