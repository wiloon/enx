// Compile-time checks of the message contract, run by `pnpm typecheck`.
//
// They live here, not in a test file: tsconfig.app.json leaves test files
// out, and jest (ts-jest with isolatedModules) does not check types. Nothing
// imports this module, so none of it reaches a bundle.
//
// Each marked line must fail to compile; `@ts-expect-error` fails the build
// when it does not.

import { sendToBackground, sendToTab } from '@/lib/messaging'

export const undeclaredMessagesDoNotCompile = () => {
  // @ts-expect-error -- not a declared message
  void sendToBackground({ type: 'notAMessage' })
  // @ts-expect-error -- declared under `type`, not `action`
  void sendToBackground({ action: 'learningAccess' })
  // @ts-expect-error -- the payload is missing
  void sendToBackground({ type: 'savePage' })
  // @ts-expect-error -- the payload has the wrong shape
  void sendToBackground({ type: 'removeSavedPage', savedPageId: 7 })
  // @ts-expect-error -- a content-script action is not a background message
  void sendToBackground({ action: 'enxStop' })
  // @ts-expect-error -- a background message is not a content-script action
  void sendToTab(7, { type: 'getOneWord', word: 'cat' })
  // @ts-expect-error -- not a declared action
  void sendToTab(7, { action: 'notAnAction' })
}

export const aResponseBelongsToItsRequest = () =>
  sendToBackground({ type: 'learningAccess' }).then(reply => {
    // @ts-expect-error -- this request's response has no `success`
    void reply.success
    return reply.access
  })
