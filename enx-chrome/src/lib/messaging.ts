// Typed senders for the messages in lib/messageContract.ts: a call site can
// send only a declared request and reads back that request's response type.
// Nothing here changes what goes on the wire.

import { sendRuntimeMessage } from '@/lib/extensionContext'
import type {
  BackgroundRequest,
  BackgroundResponseOf,
  ContentRequest,
  ContentResponseOf,
} from '@/lib/messageContract'

type Runtime = Pick<typeof chrome.runtime, 'sendMessage'>
type PageRuntime = Parameters<typeof sendRuntimeMessage>[1]
type Tabs = Pick<typeof chrome.tabs, 'sendMessage'>

// From an extension page (popup, side panel, options). Rejects, as
// chrome.runtime.sendMessage does, when the background cannot be reached;
// each caller decides what that means for it.
export const sendToBackground = <Request extends BackgroundRequest>(
  request: Request,
  runtime: Runtime = chrome.runtime
): Promise<BackgroundResponseOf<Request>> => runtime.sendMessage(request)

// What a content script gets back when the message never reached the
// background or no answer came (lib/extensionContext.ts).
export interface PageSendFailure {
  success: false
  error: string
  extensionUpdated?: boolean
}

// From a content script. Never rejects: a script cut off by an extension
// update gets `extensionUpdated: true` (lib/extensionContext.ts).
export const sendToBackgroundFromPage = <Request extends BackgroundRequest>(
  request: Request,
  runtime?: PageRuntime
): Promise<BackgroundResponseOf<Request> | PageSendFailure> =>
  (runtime === undefined
    ? sendRuntimeMessage(request)
    : sendRuntimeMessage(request, runtime)) as Promise<
    BackgroundResponseOf<Request> | PageSendFailure
  >

// To a tab's content script: every frame, or one frame with `options`.
// Rejects, as chrome.tabs.sendMessage does, when nothing in the tab listens.
export const sendToTab = <Request extends ContentRequest>(
  tabId: number,
  request: Request,
  options?: chrome.tabs.MessageSendOptions,
  tabs: Tabs = chrome.tabs
): Promise<ContentResponseOf<Request>> =>
  options === undefined
    ? tabs.sendMessage(tabId, request)
    : tabs.sendMessage(tabId, request, options)
