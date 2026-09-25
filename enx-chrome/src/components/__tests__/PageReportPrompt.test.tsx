import { fireEvent, render, screen } from '@testing-library/react'
import PageReportPrompt from '../PageReportPrompt'

const URL_SHOWN = 'https://x.com/a/status/1'

const setup = (status: 'idle' | 'sending' | 'sent' | 'failed' = 'idle') => {
  const onSend = jest.fn()
  const onDismiss = jest.fn()
  render(
    <PageReportPrompt
      url={URL_SHOWN}
      status={status}
      onSend={onSend}
      onDismiss={onDismiss}
    />
  )
  return { onSend, onDismiss }
}

describe('PageReportPrompt', () => {
  it('shows exactly the URL that will be sent, and sends nothing on render', () => {
    const { onSend } = setup()
    expect(screen.getByTestId('page-report-url')).toHaveTextContent(URL_SHOWN)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('sends only when the user presses Send report', () => {
    const { onSend, onDismiss } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }))
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('dismisses without sending on No thanks', () => {
    const { onSend, onDismiss } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'No thanks' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('disables both buttons while sending', () => {
    setup('sending')
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'No thanks' })).toBeDisabled()
  })

  it('offers a retry with an error when sending failed', () => {
    setup('failed')
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't send the report"
    )
    expect(screen.getByRole('button', { name: 'Send report' })).toBeEnabled()
  })

  it('replaces the prompt with a thank-you once sent', () => {
    setup('sent')
    expect(screen.getByRole('status')).toHaveTextContent('report sent')
    expect(screen.queryByRole('button')).toBeNull()
  })
})
