import { fireEvent, render, screen } from '@testing-library/react'
import SaveLinkCard from '../SaveLinkCard'

const URL_SHOWN = 'https://www.infoq.com/articles/kube?id=7'

const setup = (
  props: Partial<React.ComponentProps<typeof SaveLinkCard>> = {}
) => {
  const onSave = jest.fn()
  const onRemove = jest.fn()
  render(
    <SaveLinkCard
      url={URL_SHOWN}
      saved={false}
      busy={null}
      savedListUrl="https://catglish.test/saved"
      onSave={onSave}
      onRemove={onRemove}
      {...props}
    />
  )
  return { onSave, onRemove }
}

describe('SaveLinkCard', () => {
  it('shows the exact address and says only the link is saved, saving nothing on render', () => {
    const { onSave } = setup()

    expect(screen.getByTestId('save-link-url')).toHaveTextContent(URL_SHOWN)
    expect(screen.getByText('Save link')).toBeInTheDocument()
    expect(
      screen.getByText('Saves the link and title, not the page content')
    ).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves with a single click, with no confirmation step', () => {
    const { onSave } = setup()

    fireEvent.click(screen.getByTestId('save-link-card'))

    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('cannot be clicked again while saving', () => {
    setup({ busy: 'saving' })

    expect(screen.getByText('Saving…')).toBeInTheDocument()
    expect(screen.getByTestId('save-link-card')).toBeDisabled()
  })

  it('once saved, says so and offers Remove', () => {
    const { onRemove, onSave } = setup({ saved: true })

    expect(screen.getByRole('status')).toHaveTextContent('Link saved')
    fireEvent.click(screen.getByTestId('save-link-remove'))

    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('once saved, links to the full Saved list on the website in a new tab', () => {
    setup({ saved: true })

    const link = screen.getByTestId('save-link-view-all')
    expect(link).toHaveAttribute('href', 'https://catglish.test/saved')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('does not offer the Saved list before the link is saved', () => {
    setup()

    expect(screen.queryByTestId('save-link-view-all')).not.toBeInTheDocument()
  })

  it('shows the error it is given', () => {
    setup({ error: 'You can save up to 1000 pages.' })

    expect(screen.getByRole('alert')).toHaveTextContent(
      'You can save up to 1000 pages.'
    )
  })
})
