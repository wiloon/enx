// ADR-095: the popup in a browser that never signed in.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

jest.mock('@/config/env')
jest.mock('@/lib/sentry', () => ({ initSentry: jest.fn() }))
jest.mock('@/lib/enableLearningMode', () => ({
  disableLearningModeOnTab: jest.fn(),
  enableLearningModeOnTab: jest.fn(async () => ({
    success: false,
    error: "Couldn't turn on Catglish",
  })),
  getLearningModeStatusOnTab: jest.fn(async () => 'off'),
}))
jest.mock('@/lib/auth/selectPopupAuth', () => {
  /* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factory */
  const { createElement } = require('react') as typeof import('react')
  const { AuthContext } =
    require('@/lib/auth/context') as typeof import('@/lib/auth/context')
  /* eslint-enable @typescript-eslint/no-require-imports */
  const value = {
    isLoaded: true,
    isSignedIn: false,
    user: null,
    sessionId: null,
    signOut: async () => {},
  }
  const Provider = ({ children }: { children: ReactNode }) =>
    createElement(AuthContext.Provider, { value }, children)
  return { selectPopupAuth: () => ({ Provider }) }
})

import Popup from '../Popup'

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  ;(chrome.runtime.sendMessage as jest.Mock).mockImplementation(
    async (message: { type?: string }) =>
      message.type === 'learningAccess' ? { access: 'anonymous' } : undefined
  )
  ;(chrome.tabs.query as jest.Mock).mockResolvedValue([{ id: 1 }])
  ;(chrome.commands.getAll as jest.Mock).mockResolvedValue([])
  ;(chrome.storage.local.get as jest.Mock).mockResolvedValue({})
  ;(chrome.runtime.getManifest as jest.Mock).mockReturnValue({
    version: '0.0.0',
  })
})

it('shows a failed enable once', async () => {
  render(<Popup />)

  fireEvent.click(
    await screen.findByRole('button', { name: /Read with Catglish/ })
  )

  await screen.findAllByText("Couldn't turn on Catglish")
  expect(screen.getAllByText("Couldn't turn on Catglish")).toHaveLength(1)
})

it('asks the background which mode a signed-out browser reads in', async () => {
  render(<Popup />)

  await screen.findByRole('button', { name: /Read with Catglish/ })
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
    type: 'learningAccess',
  })
})

it('keeps the signed-out popup when the mode cannot be fetched', async () => {
  const sendMessage = chrome.runtime.sendMessage as jest.Mock
  sendMessage.mockImplementation(async () => {
    throw new Error('Could not establish connection.')
  })

  render(<Popup />)

  await waitFor(() => {
    expect(sendMessage).toHaveBeenCalledWith({ type: 'learningAccess' })
  })
  // Let the rejected reply settle before asserting on what it left behind.
  await screen.findByRole('heading', { name: 'Sign in to Catglish' })
  await Promise.resolve()
  expect(
    screen.queryByRole('button', { name: /Read with Catglish/ })
  ).not.toBeInTheDocument()
})
