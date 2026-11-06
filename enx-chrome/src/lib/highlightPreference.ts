// The "highlight vocabulary while reading" preference decides only whether
// the paint window runs (ADR-011 Decision 3, ADR-069 Decision 2); word data
// and click-to-lookup never depend on it. A processing run reads the stored
// value, then paints at one synchronous point; a flip can land while that
// read is pending, and the run must then follow the flip, not its own read.

export interface HighlightPaint {
  /** Starts a paint window over the current blocks, replacing any window. */
  start: () => void
  /** Clears the paint window, if any. */
  stop: () => void
}

export interface HighlightPreferenceDeps {
  /** Reads the stored preference. */
  read: () => Promise<boolean>
  paint: HighlightPaint
}

export interface HighlightPreference {
  /**
   * Refreshes the latest value from storage before a run's paint point. A
   * flip that arrives while the read is pending wins over what it returns.
   */
  load: () => Promise<void>
  /** A flip from the popup or options page: repaints or clears at once. */
  changed: (enabled: boolean) => void
  /**
   * The run's synchronous paint point, after its blocks are partitioned:
   * paints if the latest value is on, clears otherwise. Returns whether it
   * painted.
   */
  paintRun: () => boolean
}

export function createHighlightPreference(
  deps: HighlightPreferenceDeps
): HighlightPreference {
  let latest = true
  let flips = 0

  const apply = () => {
    if (latest) deps.paint.start()
    else deps.paint.stop()
    return latest
  }

  return {
    load: async () => {
      const flipsBefore = flips
      const stored = await deps.read()
      if (flips === flipsBefore) latest = stored
    },
    changed: enabled => {
      flips++
      latest = enabled
      apply()
    },
    paintRun: apply,
  }
}
