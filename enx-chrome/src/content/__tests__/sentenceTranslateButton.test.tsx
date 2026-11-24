import type { Root } from 'react-dom/client'
import {
  positionHoverSentenceButton,
  positionSelectionHint,
} from '@/lib/overlayPositioning'
import { mountSentenceTranslateButton } from '../sentenceTranslateButton'

jest.mock('@/lib/overlayPositioning')

it.each(['start', 'end'] as const)(
  'anchors at the first usable line from the %s of the selection',
  anchor => {
    const zero = new DOMRect()
    const first = new DOMRect(20, 40, 80, 20)
    const last = new DOMRect(20, 70, 60, 20)
    const reference = document.createRange()
    reference.getClientRects = () =>
      [zero, first, last, zero] as unknown as DOMRectList
    const mountShadowRoot = (host: HTMLElement): Root => {
      Object.assign(host, { showPopover: jest.fn() })
      return { render: jest.fn(), unmount: jest.fn() }
    }
    const { cleanup } = mountSentenceTranslateButton({
      className: 'enx-selection-translate-button',
      title: 'Translate selection',
      ariaLabel: 'Translate selection',
      reference,
      anchor,
      placement: anchor === 'start' ? 'top-start' : 'bottom-end',
      onTrigger: jest.fn(),
      mountShadowRoot,
    })

    try {
      const [positionReference] = jest.mocked(positionSelectionHint).mock
        .lastCall!
      expect(positionReference.getBoundingClientRect()).toBe(
        anchor === 'start' ? first : last
      )
    } finally {
      cleanup()
    }
  }
)

describe("placement 'last-character' (hover, #1125)", () => {
  const usable = new DOMRect(110, 40, 6, 20)
  const zero = new DOMRect(116, 40, 0, 0)
  let rectsFor: (text: string) => DOMRect[]
  const original = Range.prototype.getClientRects

  beforeEach(() => {
    jest.mocked(positionHoverSentenceButton).mockClear()
    jest.mocked(positionSelectionHint).mockClear()
    // jsdom has no layout: each Range reports rects by its text.
    Range.prototype.getClientRects = function (this: Range) {
      return rectsFor(this.toString()) as unknown as DOMRectList
    }
  })
  afterEach(() => {
    Range.prototype.getClientRects = original
    document.body.innerHTML = ''
  })

  const mountOn = (html: string) => {
    document.body.innerHTML = `<p>${html}</p>`
    const reference = document.createRange()
    reference.selectNodeContents(document.querySelector('p')!)
    return mountSentenceTranslateButton({
      className: 'enx-hover-sentence-translate-button',
      title: 'Translate sentence',
      ariaLabel: 'Translate sentence',
      reference,
      anchor: 'end',
      placement: 'last-character',
      onTrigger: jest.fn(),
      mountShadowRoot: host => {
        Object.assign(host, { showPopover: jest.fn() })
        return { render: jest.fn(), unmount: jest.fn() } as unknown as Root
      },
    })
  }

  it("positions off the last character's usable rect, skipping zero-size ones", () => {
    rectsFor = text => (text === '.' ? [usable, zero] : [])
    const { cleanup } = mountOn('It rained.')
    try {
      expect(jest.mocked(positionHoverSentenceButton).mock.lastCall?.[0]).toBe(
        usable
      )
      expect(positionSelectionHint).not.toHaveBeenCalled()
    } finally {
      cleanup()
    }
  })

  it.each([
    ['the last character has no usable rect', 'It rained.'],
    ['the sentence has no visible character', '   '],
  ])('falls back below the sentence end when %s', (_case, html) => {
    rectsFor = text => (text === '.' ? [zero] : [])
    const { cleanup } = mountOn(html)
    try {
      expect(positionHoverSentenceButton).not.toHaveBeenCalled()
      expect(jest.mocked(positionSelectionHint).mock.lastCall?.[2]).toBe(
        'bottom-end'
      )
    } finally {
      cleanup()
    }
  })
})
