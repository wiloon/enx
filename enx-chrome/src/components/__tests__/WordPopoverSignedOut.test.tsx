import { fireEvent, render, screen } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import WordPopover from '@/components/WordPopover'
import { signedOutAtom } from '@/store/atoms'

jest.mock('@/lib/aiLookup', () => ({
  billingUrl: (src: string) => `https://enx.example.test/billing?src=${src}`,
  stopAutomaticAiLookup: jest.fn(),
}))
jest.mock('@/lib/serverPreferences', () => ({ fetchPreferences: jest.fn() }))

describe('WordPopover signed-out state (#236)', () => {
  it('says the reader was signed out and offers Sign in', () => {
    const store = createStore()
    store.set(signedOutAtom, true)
    const onSignIn = jest.fn()
    render(
      <Provider store={store}>
        <WordPopover
          word="hello"
          onClose={jest.fn()}
          onMarkKnown={jest.fn()}
          onOpenSentencePanel={jest.fn()}
          onSignIn={onSignIn}
        />
      </Provider>
    )

    expect(screen.getByTestId('word-popover-signed-out')).toHaveTextContent(
      "You've been signed out. Sign in to keep looking up words."
    )
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(onSignIn).toHaveBeenCalledTimes(1)
  })
})
