// The site header's UiLanguageSwitch reads the App Router, which a component
// test does not mount:
//   jest.mock('next/navigation', () =>
//     jest.requireActual('@/test-utils/navigation')
//   )
export const usePathname = () => '/'
export const useRouter = () => ({
  push: jest.fn(),
  replace: jest.fn(),
  refresh: jest.fn(),
})
export const useSearchParams = () => new URLSearchParams()
