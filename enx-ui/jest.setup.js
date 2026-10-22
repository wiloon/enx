import '@testing-library/jest-dom'
import { format } from 'util'

if (!global.fetch) {
  global.fetch = jest.fn()
}

// Fails a test on any console.error / console.warn it did not expect. A test
// that expects a log mutes it with its own jest.spyOn(...).mockImplementation
// and asserts the call. Calls are recorded rather than thrown, so a call from a
// timer or a late promise is still reported, against the current test or, after
// the file's last test, in afterAll.
const guardedMethods = ['error', 'warn']
const originalConsole = Object.fromEntries(
  guardedMethods.map((method) => [method, console[method]])
)
let unexpectedConsoleCalls = []
const guardWrappers = Object.fromEntries(
  guardedMethods.map((method) => [
    method,
    (...args) => {
      unexpectedConsoleCalls.push(`console.${method}: ${format(...args)}`)
      originalConsole[method](...args)
    },
  ])
)

function installConsoleGuard() {
  for (const method of guardedMethods) {
    console[method] = guardWrappers[method]
  }
}

function flushUnexpectedConsoleCalls(when) {
  if (unexpectedConsoleCalls.length === 0) return
  const calls = unexpectedConsoleCalls
  unexpectedConsoleCalls = []
  throw new Error(
    `Unexpected console output ${when}. Let the component settle (findBy…/waitFor), ` +
      `or, if the log is intended, mock it with jest.spyOn(console, …) and assert the call.\n\n` +
      calls.join('\n\n')
  )
}

// Captured before any test can install fake timers.
const realSetTimeout = global.setTimeout

installConsoleGuard()

beforeEach(() => {
  installConsoleGuard()
  flushUnexpectedConsoleCalls('between tests, from an earlier test')
})

afterEach(() => {
  installConsoleGuard()
  flushUnexpectedConsoleCalls('during this test')
})

afterAll(async () => {
  // Let callbacks already queued by the last test run before checking. This
  // yields a single macrotask only: a console.error or console.warn scheduled
  // to fire after it (a later timer, a promise chain that outlasts it) misses
  // the final check and may be lost when the environment tears down.
  await new Promise((resolve) => realSetTimeout(resolve, 0))
  flushUnexpectedConsoleCalls("after this file's last test")
})
