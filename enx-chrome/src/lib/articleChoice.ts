// ADR-073: local article choices. Browser storage, selector matching and
// learning mode enter through the interface; this core has no DOM or I/O.
export interface ArticleChoiceStatus {
  source: 'automatic' | 'your-choice'
  saved: boolean
  missed: boolean
}

interface ArticleChoiceDeps<N> {
  read: () => Promise<string | null>
  write: (selector: string | null) => Promise<void>
  resolve: (selector: string) => N[]
  selectorFor: (node: N) => string | null
  isEligible: (node: N) => boolean
}

export function createArticleChoice<N>(deps: ArticleChoiceDeps<N>) {
  let selector: string | null = null
  let pageNode: N | undefined
  return {
    async load() {
      selector = await deps.read()
    },
    async confirm(node: N) {
      if (!deps.isEligible(node))
        throw new Error('Choose an article container inside the page.')
      const candidate = deps.selectorFor(node)
      await deps.write(candidate)
      selector = candidate
      pageNode = node
    },
    async useAutomatic() {
      await deps.write(null)
      selector = null
      pageNode = undefined
    },
    /** The remembered selector; null for automatic or a page-only choice. */
    selector: () => selector,
    current(): ArticleChoiceStatus & { node?: N } {
      if (pageNode !== undefined && deps.isEligible(pageNode)) {
        return {
          node: pageNode,
          source: 'your-choice',
          saved: selector !== null,
          missed: false,
        }
      }
      const matches = selector ? deps.resolve(selector) : []
      if (matches.length === 1 && deps.isEligible(matches[0])) {
        return {
          node: matches[0],
          source: 'your-choice',
          saved: true,
          missed: false,
        }
      }
      return {
        source: 'automatic',
        saved: selector !== null,
        missed: selector !== null,
      }
    },
  }
}

// Conservative: reject common CSS-in-JS prefixes, module suffixes and
// mixed letter/digit hash tokens. A missed persistence opportunity is safe.
export function isStableArticleClass(name: string): boolean {
  const suffix = name.match(/_([a-zA-Z0-9]{5,})$/)?.[1]
  if (suffix && /[A-Z]/.test(suffix) && /[a-z]/.test(suffix)) return false
  return (
    !/^(?:css|jsx|sc)-/i.test(name) &&
    !/(?:^|[-_])[a-f0-9]{6,}$/i.test(name) &&
    !/(?:^|[-_])(?=[a-z0-9]{6,}$)(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]+$/i.test(
      name
    )
  )
}

export function createArticlePickSession<N>(deps: {
  mode: {
    isOn: () => boolean
    stop: () => void
    enable: () => Promise<unknown>
  }
  confirm: (node: N) => Promise<void>
  useAutomatic: () => Promise<void>
}) {
  let wasOn: boolean | null = null
  let generation = 0
  return {
    begin() {
      if (wasOn !== null) return
      generation++
      wasOn = deps.mode.isOn()
      deps.mode.stop()
    },
    abandon() {
      generation++
      wasOn = null
    },
    async confirm(node: N) {
      const current = generation
      await deps.confirm(node)
      if (current !== generation) return
      wasOn = null
      await deps.mode.enable()
    },
    async useAutomatic() {
      const resume = wasOn ?? deps.mode.isOn()
      const current = ++generation
      await deps.useAutomatic()
      if (current !== generation) return
      wasOn = null
      deps.mode.stop()
      if (resume) await deps.mode.enable()
    },
    async cancel() {
      const resume = wasOn
      generation++
      wasOn = null
      if (resume) await deps.mode.enable()
    },
  }
}
