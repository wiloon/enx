// ADR-088 Decision 1: tomeshelf writes its generator meta only after the
// reading view mounts, so the content script watches <head> from startup
// with no timeout, disconnecting only on stand-down or once recognised.

export interface TomeshelfWatchDeps {
  /** True when the page currently looks like tomeshelf. */
  isTomeshelf: () => boolean
  /** Called once, the first time tomeshelf is seen. */
  onRecognised: () => void
  /** Usually document.head; falls back to documentElement when head is missing. */
  root: Node
}

export interface TomeshelfWatch {
  disconnect: () => void
}

export function watchTomeshelfRecognition(
  deps: TomeshelfWatchDeps
): TomeshelfWatch {
  // Already present at startup: the normal load path (auto-enable / enxRun)
  // uses the adapter. Only a recognition that arrives later switches once.
  if (deps.isTomeshelf()) {
    return { disconnect: () => {} }
  }

  let done = false
  const finish = () => {
    if (done) return
    done = true
    observer.disconnect()
    deps.onRecognised()
  }

  const observer = new MutationObserver(() => {
    if (deps.isTomeshelf()) finish()
  })
  observer.observe(deps.root, {
    childList: true,
    subtree: true,
    attributes: true,
  })

  return {
    disconnect: () => {
      done = true
      observer.disconnect()
    },
  }
}
