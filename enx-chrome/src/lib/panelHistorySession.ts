import { findCard, type PanelEntry } from './panelHistory'

export interface CardRequest {
  sentenceId: string | undefined
  key: string
  token: number
}

type Update = PanelEntry[] | ((entries: PanelEntry[]) => PanelEntry[])

type ClearedHistory = {
  generation: number
  entries: PanelEntry[]
  expandedWords: Set<string>
}

// A panel's visible history and its single, temporary Undo snapshot. Request
// results can update the hidden snapshot without making it visible again.
export class PanelHistorySession {
  private generation = 0
  private paused: Array<(restored: boolean) => void> = []
  snapshot: { entries: PanelEntry[]; cleared: ClearedHistory | null } = {
    entries: [],
    cleared: null,
  }

  get entries() {
    return this.snapshot.entries
  }

  update(update: Update) {
    const entries = typeof update === 'function' ? update(this.entries) : update
    this.snapshot = { ...this.snapshot, entries }
    if (entries.length > 0) this.discardCleared()
  }

  patch(update: (entries: PanelEntry[]) => PanelEntry[]) {
    const { entries, cleared } = this.snapshot
    this.snapshot = {
      entries: update(entries),
      cleared: cleared
        ? { ...cleared, entries: update(cleared.entries) }
        : null,
    }
  }

  clear(expandedWords: Set<string>) {
    this.snapshot = {
      entries: [],
      cleared: {
        generation: ++this.generation,
        entries: this.entries,
        expandedWords,
      },
    }
  }

  undo() {
    const cleared = this.snapshot.cleared
    if (!cleared) return
    this.snapshot = { entries: cleared.entries, cleared: null }
    this.finishPaused(true)
    return cleared.expandedWords
  }

  discardCleared() {
    this.snapshot = { ...this.snapshot, cleared: null }
    this.finishPaused(false)
  }

  // Dictionary results and their paid continuation run only for a visible
  // card. While Undo is offered, retain the work without issuing new I/O.
  whenVisible<T>(card: CardRequest, action: () => T): Promise<T | undefined> {
    const holds = (entries: PanelEntry[]) =>
      findCard(entries, card.sentenceId, card.key)?.token === card.token
    if (holds(this.entries)) return new Promise<T>(resolve => resolve(action()))
    if (!this.snapshot.cleared || !holds(this.snapshot.cleared.entries)) {
      return Promise.resolve(undefined)
    }
    return new Promise((resolve, reject) => {
      this.paused.push(restored => {
        if (restored) void this.whenVisible(card, action).then(resolve, reject)
        else resolve(undefined)
      })
    })
  }

  private finishPaused(restored: boolean) {
    const paused = this.paused
    this.paused = []
    paused.forEach(finish => finish(restored))
  }
}
