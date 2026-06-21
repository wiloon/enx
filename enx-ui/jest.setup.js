import '@testing-library/jest-dom'

if (!global.fetch) {
  global.fetch = jest.fn()
}
