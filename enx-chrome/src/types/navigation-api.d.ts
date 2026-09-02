// Minimal ambient types for the Navigation API (Chrome 102+), which the
// TypeScript DOM lib doesn't ship yet. Only the members ENX reads
// (ADR-011 Decision 6.1).

interface NavigateEvent extends Event {
  readonly destination: { readonly url: string }
  readonly navigationType: 'reload' | 'push' | 'replace' | 'traverse'
  readonly hashChange: boolean
  readonly downloadRequest: string | null
  readonly canIntercept: boolean
}

interface Navigation extends EventTarget {
  addEventListener(
    type: 'navigate',
    listener: (event: NavigateEvent) => void
  ): void
  removeEventListener(
    type: 'navigate',
    listener: (event: NavigateEvent) => void
  ): void
}

interface Window {
  readonly navigation?: Navigation
}
