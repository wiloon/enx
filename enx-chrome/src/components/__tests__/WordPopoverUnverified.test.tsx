import { fireEvent, render, screen, within } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import WordPopover from '@/components/WordPopover'
import { currentWordAtom, sessionUnverifiedAtom } from '@/store/atoms'
import type { WordData } from '@/types'

jest.mock('@/lib/aiLookup', () => ({
  billingUrl: (src: string) => `https://enx.example.test/billing?src=${src}`,
  stopAutomaticAiLookup: jest.fn(),
}))
jest.mock('@/lib/serverPreferences', () => ({ fetchPreferences: jest.fn() }))

const MISS: WordData = {
  Key: 'rizzler',
  English: 'rizzler',
  Pronunciation: '',
  Chinese: '',
  LoadCount: 0,
  Known: false,
  WordType: 0,
  AIFallback: { CanUse: true, Auto: false },
}

const renderUnverified = (
  setUp: (store: ReturnType<typeof createStore>) => void
) => {
  const store = createStore()
  setUp(store)
  const onRetry = jest.fn()
  const onSignIn = jest.fn()
  render(
    <Provider store={store}>
      <WordPopover
        word="rizzler"
        onClose={jest.fn()}
        onMarkKnown={jest.fn()}
        onOpenSentencePanel={jest.fn()}
        onRetryUnverified={onRetry}
        onSignIn={onSignIn}
      />
    </Provider>
  )
  return { onRetry, onSignIn }
}

describe('WordPopover unverified state (#686)', () => {
  it('says the sign-in could not be verified and offers Retry, then Sign in', () => {
    const { onRetry, onSignIn } = renderUnverified(store =>
      store.set(sessionUnverifiedAtom, 'lookup')
    )

    const notice = screen.getByTestId('word-popover-unverified')
    expect(notice).toHaveTextContent(
      "We couldn't verify your sign-in. Try again, or sign in again."
    )
    expect(
      within(notice)
        .getAllByRole('button')
        .map(b => b.textContent)
    ).toEqual(['Retry', 'Sign in'])
    fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    fireEvent.click(within(notice).getByRole('button', { name: 'Sign in' }))
    expect(onSignIn).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('word-popover-signed-out')).toBeNull()
  })

  it('shows the notice in place of the miss an AI lookup was asked for', () => {
    renderUnverified(store => {
      store.set(currentWordAtom, MISS)
      store.set(sessionUnverifiedAtom, 'ai-lookup')
    })

    expect(screen.getByTestId('word-popover-unverified')).toBeInTheDocument()
    expect(screen.queryByTestId('word-popover-not-found')).toBeNull()
    expect(screen.queryByTestId('word-popover-ai-lookup')).toBeNull()
  })
})
