import { fireEvent, render, screen } from '@testing-library/react'
import PageSavePrompt, { PageSaveStatus } from '../PageSavePrompt'

const URL_SHOWN = 'https://www.infoq.com/articles/kube?utm_source=x'
const TITLE_SHOWN = 'Kubernetes operators in practice'

const setup = (
  status: PageSaveStatus = 'idle',
  extra: { savedUrl?: string; errorMessage?: string } = {}
) => {
  const onSave = jest.fn()
  const onCancel = jest.fn()
  render(
    <PageSavePrompt
      url={URL_SHOWN}
      title={TITLE_SHOWN}
      status={status}
      onSave={onSave}
      onCancel={onCancel}
      {...extra}
    />
  )
  return { onSave, onCancel }
}

describe('PageSavePrompt', () => {
  it('shows exactly the address and title it would save, and saves nothing on render', () => {
    const { onSave } = setup()
    expect(screen.getByTestId('page-save-url')).toHaveTextContent(URL_SHOWN)
    expect(screen.getByTestId('page-save-title')).toHaveTextContent(TITLE_SHOWN)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves only when the user presses Save, and cancels without saving', () => {
    const { onSave, onCancel } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('shows the address that was actually stored once saved, with no further actions', () => {
    setup('saved', { savedUrl: 'https://www.infoq.com/articles/kube' })
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
    expect(screen.getByTestId('page-saved-url')).toHaveTextContent(
      'https://www.infoq.com/articles/kube'
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says so when the page was already saved', () => {
    setup('already-saved', { savedUrl: 'https://www.infoq.com/articles/kube' })
    expect(screen.getByRole('status')).toHaveTextContent('Already saved')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it("shows the server's reason when saving fails and lets the user try again", () => {
    const { onSave } = setup('failed', {
      errorMessage: 'You can save up to 1000 pages. Delete some to save more.',
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'You can save up to 1000 pages. Delete some to save more.'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('disables both buttons while saving', () => {
    setup('saving')
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })
})
