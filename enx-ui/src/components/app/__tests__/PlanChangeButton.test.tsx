import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import PlanChangeButton from '../PlanChangeButton'
import { UNREACHABLE_MESSAGE } from '@/lib/apiErrors'
import { LEGAL } from '@/lib/legal'

const mockCreate = jest.fn()
jest.mock('@/services/api', () => ({
  apiService: {
    createPlanChangeSession: (...args: unknown[]) => mockCreate(...args),
  },
}))

const FALLBACK = 'Could not open the plan change. Please try again later.'
const mockAssign = jest.fn()
jest.mock('@/lib/navigation', () => ({
  redirectTo: (url: string) => mockAssign(url),
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockCreate.mockResolvedValue({
    success: true,
    data: { success: true, url: 'https://stripe.test/confirm' },
  })
})

const button = () => screen.getByRole('button')

describe('PlanChangeButton', () => {
  it('is labelled Change plan and requests the target plan on click', async () => {
    render(<PlanChangeButton plan="max" />)
    expect(button()).toHaveTextContent('Change plan')
    fireEvent.click(button())
    await waitFor(() => expect(mockAssign).toHaveBeenCalled())
    expect(mockCreate).toHaveBeenCalledWith('max')
  })

  it('navigates to the returned URL', async () => {
    render(<PlanChangeButton plan="max" />)
    fireEvent.click(button())
    await waitFor(() =>
      expect(mockAssign).toHaveBeenCalledWith('https://stripe.test/confirm')
    )
  })

  it.each([
    ['no data', { success: true }],
    ['an empty URL', { success: true, data: { success: true, url: '' } }],
    ['a non-string URL', { success: true, data: { success: true, url: 4 } }],
  ])('shows the fallback when a 200 has %s', async (_n, resp) => {
    mockCreate.mockResolvedValue(resp)
    render(<PlanChangeButton plan="max" />)
    fireEvent.click(button())
    expect(await screen.findByRole('alert')).toHaveTextContent(FALLBACK)
    expect(mockAssign).not.toHaveBeenCalled()
    expect(button()).toBeEnabled()
  })

  it.each([
    'deletion_in_progress',
    'subscription_conflict',
    'not_a_plan_change',
    'subscription_needs_attention',
  ])('shows the message of the 409 reason %s', async (reason) => {
    const onNeedsSupport = jest.fn()
    mockCreate.mockResolvedValue({
      success: false,
      status: 409,
      reason,
      error: `Message for ${reason}.`,
    })
    render(<PlanChangeButton plan="max" onNeedsSupport={onNeedsSupport} />)
    fireEvent.click(button())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Message for ${reason}.`
    )
    if (reason === 'subscription_conflict') {
      expect(onNeedsSupport).toHaveBeenCalledTimes(1)
    } else {
      expect(onNeedsSupport).not.toHaveBeenCalled()
    }
  })

  it('passes the conflict subscription id to onNeedsSupport', async () => {
    const onNeedsSupport = jest.fn()
    mockCreate.mockResolvedValue({
      success: false,
      status: 409,
      reason: 'subscription_conflict',
      subscriptionId: 'sub_9',
      error: 'Contact support.',
    })
    render(<PlanChangeButton plan="max" onNeedsSupport={onNeedsSupport} />)
    fireEvent.click(button())
    await waitFor(() => expect(onNeedsSupport).toHaveBeenCalledWith('sub_9'))
  })

  it('calls onNeedsSupport with undefined when the conflict has no id', async () => {
    const onNeedsSupport = jest.fn()
    mockCreate.mockResolvedValue({
      success: false,
      status: 409,
      reason: 'subscription_conflict',
      error: 'Contact support.',
    })
    render(<PlanChangeButton plan="max" onNeedsSupport={onNeedsSupport} />)
    fireEvent.click(button())
    await waitFor(() => expect(onNeedsSupport).toHaveBeenCalledTimes(1))
    expect(onNeedsSupport).toHaveBeenCalledWith(undefined)
  })

  it('does not call onNeedsSupport for a conflict reason on another status', async () => {
    const onNeedsSupport = jest.fn()
    mockCreate.mockResolvedValue({
      success: false,
      status: 400,
      reason: 'subscription_conflict',
      error: 'Odd.',
    })
    render(<PlanChangeButton plan="max" onNeedsSupport={onNeedsSupport} />)
    fireEvent.click(button())
    expect(await screen.findByRole('alert')).toHaveTextContent('Odd.')
    expect(onNeedsSupport).not.toHaveBeenCalled()
  })

  it.each([undefined, 'something_new'])(
    'shows the error without the callback for reason %p',
    async (reason) => {
      const onNeedsSupport = jest.fn()
      mockCreate.mockResolvedValue({
        success: false,
        status: 409,
        reason,
        error: 'Blocked.',
      })
      render(<PlanChangeButton plan="max" onNeedsSupport={onNeedsSupport} />)
      fireEvent.click(button())
      expect(await screen.findByRole('alert')).toHaveTextContent('Blocked.')
      expect(onNeedsSupport).not.toHaveBeenCalled()
    }
  )

  it('works for a conflict when no callback is given', async () => {
    mockCreate.mockResolvedValue({
      success: false,
      status: 409,
      reason: 'subscription_conflict',
      error: 'Contact support.',
    })
    render(<PlanChangeButton plan="max" />)
    fireEvent.click(button())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Contact support.'
    )
  })

  it.each([
    ['400', 'Bad plan.'],
    ['404', 'No subscription.'],
    [
      '503',
      `Try later. If this keeps happening, contact ${LEGAL.contactEmail}.`,
    ],
    ['network', UNREACHABLE_MESSAGE],
  ])('shows the shared client error unchanged on %s', async (_n, error) => {
    mockCreate.mockResolvedValue({ success: false, error })
    render(<PlanChangeButton plan="max" />)
    fireEvent.click(button())
    expect(await screen.findByRole('alert')).toHaveTextContent(error)
  })

  it('shows the fallback when the failure has an empty error', async () => {
    mockCreate.mockResolvedValue({ success: false, error: '' })
    render(<PlanChangeButton plan="max" />)
    fireEvent.click(button())
    expect(await screen.findByRole('alert')).toHaveTextContent(FALLBACK)
  })

  it('sends one request for two clicks before the pending state renders', async () => {
    let resolve: (v: unknown) => void = () => {}
    mockCreate.mockReturnValue(new Promise((r) => (resolve = r)))
    render(<PlanChangeButton plan="max" />)
    act(() => {
      fireEvent.click(button())
      expect(button()).toBeEnabled()
      fireEvent.click(button())
    })
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(button()).toHaveTextContent('Opening…')
    expect(button()).toBeDisabled()
    resolve({ success: false, error: 'Nope.' })
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('clears the error and can retry after a failure', async () => {
    mockCreate.mockResolvedValueOnce({ success: false, error: 'Nope.' })
    render(<PlanChangeButton plan="max" />)
    fireEvent.click(button())
    expect(await screen.findByRole('alert')).toHaveTextContent('Nope.')
    expect(button()).toBeEnabled()
    expect(button()).toHaveTextContent('Change plan')

    let resolve: (v: unknown) => void = () => {}
    mockCreate.mockReturnValue(new Promise((r) => (resolve = r)))
    fireEvent.click(button())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mockCreate).toHaveBeenCalledTimes(2)
    resolve({ success: true, data: { success: true, url: 'https://x.test' } })
    await waitFor(() =>
      expect(mockAssign).toHaveBeenCalledWith('https://x.test')
    )
  })
})
