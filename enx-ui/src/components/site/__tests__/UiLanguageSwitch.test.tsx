import { fireEvent, screen } from '@testing-library/react'
import UiLanguageSwitch from '../UiLanguageSwitch'
import { renderWithIntl } from '@/test-utils/intl'

const push = jest.fn()
let pathname = '/privacy'

jest.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push }),
}))

const clearChoice = () => {
  document.cookie = 'catglish_ui_language=; Max-Age=0; Path=/'
}

beforeEach(() => {
  push.mockClear()
  clearChoice()
  pathname = '/privacy'
})

afterAll(clearChoice)

// ADR-096 Decision 4: the switch is the only thing that writes the choice
// cookie, and it moves a localised page to its other-language URL.
describe.each(['bar', 'menu'] as const)('UiLanguageSwitch (%s)', (variant) => {
  it('takes an English legal page to its Chinese URL and records the choice', () => {
    renderWithIntl(<UiLanguageSwitch variant={variant} />)

    fireEvent.click(screen.getByRole('button', { name: /简体中文/ }))

    expect(document.cookie).toContain('catglish_ui_language=zh')
    expect(push).toHaveBeenCalledWith('/zh/privacy')
  })

  it('takes a Chinese legal page back to the unprefixed URL', () => {
    pathname = '/zh/terms'
    renderWithIntl(<UiLanguageSwitch variant={variant} />, 'zh')

    fireEvent.click(screen.getByRole('button', { name: /English/ }))

    expect(document.cookie).toContain('catglish_ui_language=en')
    expect(push).toHaveBeenCalledWith('/terms')
  })

  it('records the choice but stays on a page that is not localised', () => {
    pathname = '/pricing'
    renderWithIntl(<UiLanguageSwitch variant={variant} />)

    fireEvent.click(screen.getByRole('button', { name: /简体中文/ }))

    expect(document.cookie).toContain('catglish_ui_language=zh')
    expect(push).not.toHaveBeenCalled()
  })
})

describe('UiLanguageSwitch in the menu', () => {
  it('lists both languages and marks the current one', () => {
    renderWithIntl(<UiLanguageSwitch variant="menu" />, 'zh')

    expect(screen.getByRole('group', { name: '界面语言' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '简体中文' })).toHaveAttribute(
      'aria-current',
      'true'
    )
    expect(screen.getByRole('button', { name: 'English' })).not.toHaveAttribute(
      'aria-current'
    )
  })
})
