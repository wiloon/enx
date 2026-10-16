import { fireEvent, render, screen } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import WordPopover from '@/components/WordPopover'
import { EXTENSION_UPDATED_MESSAGE } from '@/lib/extensionContext'
import { errorAtom, errorNeedsReloadAtom } from '@/store/atoms'

jest.mock('@/lib/aiLookup', () => ({
  billingUrl: (src: string) => `https://enx.example.test/billing?src=${src}`,
  stopAutomaticAiLookup: jest.fn(),
}))
jest.mock('@/lib/serverPreferences', () => ({ fetchPreferences: jest.fn() }))

function renderPopover(error: string, needsReload: boolean) {
  const store = createStore()
  store.set(errorAtom, error)
  store.set(errorNeedsReloadAtom, needsReload)
  const onReloadPage = jest.fn()
  render(
    <Provider store={store}>
      <WordPopover
        word="hello"
        onClose={jest.fn()}
        onMarkKnown={jest.fn()}
        onOpenSentencePanel={jest.fn()}
        onReloadPage={onReloadPage}
      />
    </Provider>
  )
  return { onReloadPage }
}

describe('WordPopover error', () => {
  it('offers Reload page when the extension was updated under this tab', () => {
    const { onReloadPage } = renderPopover(EXTENSION_UPDATED_MESSAGE, true)

    expect(screen.getByTestId('word-popover-error')).toHaveTextContent(
      EXTENSION_UPDATED_MESSAGE
    )
    fireEvent.click(screen.getByTestId('word-popover-reload-page'))
    expect(onReloadPage).toHaveBeenCalledTimes(1)
  })

  it('shows no Reload page button for other errors', () => {
    renderPopover('Service temporarily unavailable. Please retry.', false)

    expect(screen.getByTestId('word-popover-error')).toBeInTheDocument()
    expect(screen.queryByTestId('word-popover-reload-page')).toBeNull()
  })
})
