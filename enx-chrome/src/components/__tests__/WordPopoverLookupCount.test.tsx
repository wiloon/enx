import { render, screen } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import WordPopover from '@/components/WordPopover'
import { currentWordAtom } from '@/store/atoms'
import type { WordData } from '@/types'

jest.mock('@/lib/aiLookup', () => ({
  billingUrl: (src: string) => `https://enx.example.test/billing?src=${src}`,
  stopAutomaticAiLookup: jest.fn(),
}))
jest.mock('@/lib/serverPreferences', () => ({ fetchPreferences: jest.fn() }))

// The lookup count reads the same here as on the Side Panel card and on
// enx-ui's Word List: the repeat icon, the bare number, and "Looked up N
// times" on hover and for screen readers.
it('shows how many times the word was looked up', () => {
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

  const count = screen.getByTitle('Looked up 3 times')
  expect(count).toHaveTextContent('3')
  expect(count).not.toHaveTextContent('×')
  expect(count).toHaveTextContent('Looked up 3 times')
})
