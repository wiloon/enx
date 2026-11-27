import { render, screen } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import WordPopover from '@/components/WordPopover'
import { currentWordAtom, lookupNoticeAtom } from '@/store/atoms'
import type { BackgroundResponse, WordData } from '@/types'

jest.mock('@/lib/aiLookup', () => ({
  billingUrl: (src: string) => `https://enx.example.test/billing?src=${src}`,
  stopAutomaticAiLookup: jest.fn(),
}))
jest.mock('@/lib/serverPreferences', () => ({ fetchPreferences: jest.fn() }))
jest.mock('@/components/ExplanationLanguageSwitch', () => ({
  __esModule: true,
  default: () => null,
}))

// A cached definition whose lookup count enx-api refused with a 429.
const renderRefused = (refusal: Partial<BackgroundResponse>) => {
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
  store.set(lookupNoticeAtom, { success: false, status: 429, ...refusal })
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
  return screen.getByTestId('word-popover-lookup-notice')
}

it('retains the cached definition with its quota notice and upgrade link below it', () => {
  const notice = renderRefused({
    code: 'lookup_quota_exceeded',
    upgrade: true,
    error: 'Daily dictionary lookup limit reached. Upgrade to Catglish Pro.',
  })

  const definition = screen.getByText(
    (_, el) => el?.tagName === 'P' && el.textContent === 'int. 你好'
  )
  expect(notice).toHaveTextContent("You've used up today's free lookups")
  expect(notice).not.toHaveTextContent('Catglish Pro')
  expect(screen.getByRole('link', { name: 'Upgrade' })).toHaveAttribute(
    'href',
    'https://enx.example.test/billing?src=lookup-miss'
  )
  expect(
    definition.compareDocumentPosition(notice) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
})

it.each([
  [
    'a subscriber',
    'lookup_quota_exceeded',
    'Daily dictionary lookup limit reached. That is unusually high for a subscription -- please contact support.',
  ],
  [
    'a refusal with no code or flag',
    undefined,
    'Daily lookup limit reached on this server.',
  ],
])("shows the server's message with no link to %s", (_name, code, message) => {
  const notice = renderRefused({ code, error: message })

  expect(notice).toHaveTextContent(message)
  expect(notice).not.toHaveTextContent('free lookups')
  expect(screen.queryByRole('link', { name: 'Upgrade' })).toBeNull()
})
