// #561: a content script outlives its extension (see extensionContext.ts).
// When the extension is reloaded, updated or reinstalled and learning mode is
// turned on again, a fresh script is injected beside the orphan, and both
// would answer every click. So every script listens for one DOM event and
// fires it when it starts and whenever it enables learning mode; a script
// whose runtime has lost its id is the orphan, and it stands down for good.
//
// The rule never compares extension ids: a live script ignores the event
// whoever fired it, so a different-ID build stands an orphan down as well.

/**
 * Builds from before and after any change must agree on this name, so it is
 * never renamed. A plain Event carries no payload across isolated worlds.
 */
export const STAND_DOWN_EVENT = 'enx-content-script-stand-down'

export interface StandDownDeps {
  /** Where the event travels: the page's document. */
  target: EventTarget
  /** The extension runtime's id now; absent once the script is orphaned. */
  runtimeId: () => string | undefined
  /** Stops everything the script does on the page. Runs once. */
  onStandDown: () => void
}

export interface StandDown {
  /** Fires the event, standing down any orphaned script on the page. */
  announce: () => void
  /** True from the moment this script stands down, permanently. */
  isStoodDown: () => boolean
}

const hasRuntime = (runtimeId: () => string | undefined): boolean => {
  try {
    return !!runtimeId()
  } catch {
    return false
  }
}

export function listenForStandDown(deps: StandDownDeps): StandDown {
  let stoodDown = false

  const listener = () => {
    if (stoodDown || hasRuntime(deps.runtimeId)) return
    stoodDown = true
    deps.target.removeEventListener(STAND_DOWN_EVENT, listener)
    deps.onStandDown()
  }
  deps.target.addEventListener(STAND_DOWN_EVENT, listener)

  return {
    announce: () => {
      deps.target.dispatchEvent(new Event(STAND_DOWN_EVENT))
    },
    isStoodDown: () => stoodDown,
  }
}
