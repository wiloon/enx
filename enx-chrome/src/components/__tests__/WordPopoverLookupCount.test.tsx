import { fireEvent, render, screen } from '@testing-library/react'
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
    Id: 'word-hello',
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

it.each([undefined, '', 'word-hello'])(
  'only stored words have review actions (Id=%s)',
  Id => {
    const store = createStore()
    store.set(currentWordAtom, {
      Id,
      Key: 'hello',
      English: 'hello',
      Chinese: '你好',
      Pronunciation: '',
      LoadCount: 0,
      Known: false,
      WordType: 0,
    })
    const onMarkKnown = jest.fn()
    const onClose = jest.fn()
    render(
      <Provider store={store}>
        <WordPopover
          word="hello"
          onClose={onClose}
          onMarkKnown={onMarkKnown}
          onOpenSentencePanel={jest.fn()}
        />
      </Provider>
    )
    const root = screen.getByTestId('word-popover-header').parentElement!
    if (Id) {
      expect(screen.getByTitle('Looked up 0 times')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /Know It/ }))
      expect(onMarkKnown).toHaveBeenCalledWith('hello')
      onMarkKnown.mockClear()
    } else {
      expect(screen.queryByTitle('Looked up 0 times')).toBeNull()
      expect(screen.queryByRole('button', { name: /Know It/ })).toBeNull()
    }
    fireEvent.keyDown(root, { key: 'Enter' })
    expect(onMarkKnown).toHaveBeenCalledTimes(Id ? 1 : 0)
    fireEvent.keyDown(root, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  }
)

it.each(['button', 'Enter'])(
  'an unstored definition has no %s review action',
  action => {
    const store = createStore()
    store.set(currentWordAtom, {
      Key: 'rizzler',
      English: 'rizzler',
      Chinese: 'n. 很有魅力的人',
      Pronunciation: '',
      Known: false,
      WordType: 0,
    })
    const onMarkKnown = jest.fn()
    render(
      <Provider store={store}>
        <WordPopover
          word="rizzler"
          onClose={jest.fn()}
          onMarkKnown={onMarkKnown}
          onOpenSentencePanel={jest.fn()}
        />
      </Provider>
    )
    if (action === 'button')
      expect(screen.queryByRole('button', { name: /Know It/ })).toBeNull()
    else {
      fireEvent.keyDown(
        screen.getByTestId('word-popover-header').parentElement!,
        { key: 'Enter' }
      )
      expect(onMarkKnown).not.toHaveBeenCalled()
    }
  }
)
