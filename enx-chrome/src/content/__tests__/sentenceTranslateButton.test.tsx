import type { Root } from 'react-dom/client'
import { positionSelectionHint } from '@/lib/overlayPositioning'
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
