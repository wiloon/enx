// jsdom has no IntersectionObserver. This fake records every instance and
// what it observes; a test decides when entries arrive.
export class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []

  readonly observed: Element[] = []
  disconnected = false

  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit = {}
  ) {
    FakeIntersectionObserver.instances.push(this)
  }

  observe(target: Element) {
    if (!this.disconnected) this.observed.push(target)
  }

  unobserve(target: Element) {
    const i = this.observed.indexOf(target)
    if (i >= 0) this.observed.splice(i, 1)
  }

  disconnect() {
    this.disconnected = true
  }

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }

  // Delivers entries for `targets`, even after disconnect: a browser may
  // already have queued them.
  fire(targets: readonly Element[] = this.observed, isIntersecting = true) {
    const entries = targets.map(
      target => ({ target, isIntersecting }) as IntersectionObserverEntry
    )
    this.callback(entries, this as unknown as IntersectionObserver)
  }
}

const registry = () =>
  globalThis.IntersectionObserver as unknown as typeof FakeIntersectionObserver

export const intersectionObservers = (): FakeIntersectionObserver[] =>
  registry().instances

export const liveIntersectionObservers = (): FakeIntersectionObserver[] =>
  registry().instances.filter(observer => !observer.disconnected)

// Every live observer reports all its targets in view.
export const showAllObserved = () =>
  liveIntersectionObservers().forEach(observer => observer.fire())
