import { render, screen } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import WordPopover from '@/components/WordPopover'
import { currentWordAtom, lookupNoticeAtom } from '@/store/atoms'
import type { WordData } from '@/types'

jest.mock('@/lib/aiLookup', () => ({
  billingUrl: (src: string) => `https://enx.example.test/billing?src=${src}`,
  stopAutomaticAiLookup: jest.fn(),
}))
jest.mock('@/lib/serverPreferences', () => ({ fetchPreferences: jest.fn() }))

// The lookup count reads the same here as on the Side Panel card and on
// enx-ui's Word List: the repeat icon, the bare number, and "Looked up N
// times" on hover and for screen readers.
it('retains the cached definition with its quota notice and upgrade link below it', () => {
  const store = createStore()
  store.set(currentWordAtom, {
    Key: 'hello',
    English: 'hello',
    Chinese: 'int. 你好',
    Pronunciation: '',
    LoadCount: 3,
    Known: false,
    WordType: 0,
  } as WordData)
  store.set(lookupNoticeAtom, {
    success: false,
    status: 429,
    code: 'lookup_quota_exceeded',
  })
  render(
    <Provider store={store}>
      <WordPopover
        word="hello"
        onClose={jest.fn()}
        onMarkKnown={jest.fn()}
        onOpenSentencePanel={jest.fn()}
        onReloadPage={jest.fn()}
      />
    </Provider>
  )

  const definition = screen.getByText('int. 你好')
  const notice = screen.getByTestId('word-popover-lookup-notice')
  expect(notice).toHaveTextContent("You've used up today's free lookups")
  expect(screen.getByRole('link', { name: 'Upgrade' })).toHaveAttribute(
    'href',
    'https://enx.example.test/billing?src=lookup-miss'
  )
  expect(
    definition.compareDocumentPosition(notice) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
})
