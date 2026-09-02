import { WordData } from '@/types'
import { nearestElement } from '@/lib/rangeUtils'

// Single source of truth for article extraction / word highlighting.
// content.tsx and its tests import this instead of keeping their own copies.
export class WordProcessor {
  static readonly WORD_PATTERNS = {
    contractedWord: /\b[a-zA-Z][a-zA-Z'''-]*[a-zA-Z]\b|\b[a-zA-Z]\b/g,
    htmlTag: /<[^>]*>/g,
    htmlEntity: /&[a-zA-Z0-9#]+;/g,
  }

  // Ancestor tags whose text is never looked up or highlighted (links,
  // form controls, code). Shared by collectTextNodes (highlight + extract
  // path) and expandToWordRange (click path) so their exclusion rules can't
  // drift apart (ADR-010 §1.3 / ADR-011 Decision 2).
  static readonly LOOKUP_EXCLUDED_TAGS = [
    'a',
    'script',
    'style',
    'noscript',
    'button',
    'input',
    'textarea',
    'select',
    'code',
    'pre',
  ]

  // CSS Custom Highlight API registry names, one per review stage
  // (ADR-011 Decision 1 / E1).
  static readonly HIGHLIGHT_NAME_PREFIX = 'enx-hl-'
  static readonly REVIEW_BUCKET_COUNT = 5

  // One shared word segmenter -- construction isn't free and tokenizeWords
  // runs once per text node.
  private static readonly wordSegmenter = new Intl.Segmenter('en', {
    granularity: 'word',
  })

  static extractWords(text: string): string[] {
    if (!text || text.trim() === '') return []

    const cleanText = text
      .replace(this.WORD_PATTERNS.htmlTag, ' ')
      .replace(this.WORD_PATTERNS.htmlEntity, ' ')

    const words = cleanText.match(this.WORD_PATTERNS.contractedWord) || []

    return words
      .map(word => word.trim())
      .filter(word => {
        return (
          word.length > 0 &&
          word.length <= 50 &&
          !/^\d+$/.test(word) &&
          /[a-zA-Z]/.test(word)
        )
      })
      .map(word => word.toLowerCase())
  }

  // Whether a word is still worth reviewing (and so worth highlighting).
  // False for words the user has marked acquainted, words tagged as a known
  // part of speech, and words never actually looked up (LoadCount 0).
  static isReviewable(wordData: WordData): boolean {
    return (
      wordData.AlreadyAcquainted !== 1 &&
      wordData.WordType !== 1 &&
      wordData.LoadCount !== 0
    )
  }

  static getColorCode(wordData: WordData): string {
    if (!this.isReviewable(wordData)) {
      return '#FFFFFF'
    }

    const loadCount = wordData.LoadCount || 0
    const normalizedCount = Math.min(loadCount, 30) / 30
    const hue = Math.round(300 * normalizedCount)

    return `hsl(${hue}, 100%, 40%)`
  }

  // The <u class="enx-word"> wrapper goes on every looked-up word so it stays
  // clickable, but only words still worth reviewing get a visible underline.
  // getColorCode() returns '#FFFFFF' as its "don't highlight" sentinel
  // (acquainted / known / never looked up) — render `none`, not a white
  // underline: white-on-white is invisible on an article page but shows up on
  // a dark background (e.g. X in dark mode), making every word look underlined.
  static getTextDecoration(wordData: WordData): string {
    const colorCode = this.getColorCode(wordData)
    return colorCode === '#FFFFFF' ? 'none' : `${colorCode} underline`
  }

  // Which review-stage bucket a word belongs to (1 = most recently learned,
  // REVIEW_BUCKET_COUNT = nearly known), or null when it shouldn't be
  // highlighted at all. Replaces the ~31-step continuous hue with a handful
  // of stages (ADR-011 E1); the "don't highlight" sentinel disappears
  // because those words simply produce no Range. Boundaries are a first
  // pass, tuned later against real articles -- keep the count of branches
  // equal to REVIEW_BUCKET_COUNT.
  static reviewBucket(wordData: WordData): number | null {
    if (!this.isReviewable(wordData)) return null

    const count = wordData.LoadCount
    if (count <= 2) return 1
    if (count <= 5) return 2
    if (count <= 10) return 3
    if (count <= 18) return 4
    return this.REVIEW_BUCKET_COUNT
  }

  // Serialize-and-write-back highlight strategy (the default for every
  // statically-rendered article site): parse `originalHtml` into a detached
  // container, wrap matched words in place inside it, hand the string back to
  // the caller to assign via `articleNode.innerHTML = ...`. The in-place
  // strategy for React-owned DOM (ADR-010) skips this wrapper and calls
  // applyHighlightsToNodes on live nodes directly.
  static renderWithHighlights(
    originalHtml: string,
    wordDict: Record<string, WordData>
  ): string {
    if (Object.keys(wordDict).length === 0) {
      return originalHtml
    }

    const tempDiv = document.createElement('div')
    tempDiv.innerHTML = originalHtml

    this.applyHighlightsToDom(tempDiv, wordDict)

    // Tag-pairing self-check: only meaningful for this serialization path,
    // where a broken fragment would corrupt the innerHTML written back. The
    // in-place path never serializes, so it skips this.
    const finalHtml = tempDiv.innerHTML
    if (finalHtml.includes('enx-word')) {
      const uTagsCount = (finalHtml.match(/<u[^>]*class="enx-word[^"]*"/g) || []).length
      const closingTagsCount = (finalHtml.match(/<\/u>/g) || []).length
      if (uTagsCount !== closingTagsCount) {
        console.error('⚠️ Tag mismatch! HTML structure may be broken')
      }
    }

    return tempDiv.innerHTML
  }

  // The eligible-text-node filter, shared by both highlight strategies and by
  // the in-place word-extraction path (ADR-010 Decision 3). Skips
  // a/script/style/noscript/button/input/textarea/select/code/pre subtrees
  // and text with no Latin letters. Keeping extraction and highlighting on
  // this single traversal is what stops their filter rules from drifting
  // apart (ADR-010 §1.3).
  // True when `node` sits inside a LOOKUP_EXCLUDED_TAGS subtree (walking up
  // to, but not including, `root`).
  static isInExcludedSubtree(node: Node, root?: Node): boolean {
    let current: HTMLElement | null = node.parentElement
    while (current && current !== root) {
      if (this.LOOKUP_EXCLUDED_TAGS.includes(current.tagName.toLowerCase())) {
        return true
      }
      current = current.parentElement
    }
    return false
  }

  static collectTextNodes(root: Node): Text[] {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: node => {
        if (!node.parentElement) return NodeFilter.FILTER_REJECT
        if (this.isInExcludedSubtree(node, root)) return NodeFilter.FILTER_REJECT

        const text = node.textContent?.trim() || ''
        return text.length > 0 && /[a-zA-Z]/.test(text)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT
      },
    })

    const textNodes: Text[] = []
    let node = walker.nextNode()
    while (node) {
      textNodes.push(node as Text)
      node = walker.nextNode()
    }
    return textNodes
  }

  // Wraps every highlighted-word occurrence inside `root` in a
  // <u class="enx-word"> element, mutating `root` in place. `root` can be a
  // detached container (renderWithHighlights) or a live DOM subtree
  // (ADR-010 Decision 4).
  static applyHighlightsToDom(
    root: Node,
    wordDict: Record<string, WordData>
  ): void {
    if (Object.keys(wordDict).length === 0) return
    this.applyHighlightsToNodes(this.collectTextNodes(root), wordDict)
  }

  // Same wrapping logic as applyHighlightsToDom, but over a text-node list
  // the caller already collected (the in-place path collects once and reuses
  // the list for word extraction). Each matched text node is replaced by a
  // DocumentFragment of text + <u> elements; unmatched nodes are untouched.
  static applyHighlightsToNodes(
    textNodes: Text[],
    wordDict: Record<string, WordData>
  ): void {
    const wordKeys = Object.keys(wordDict)
    if (wordKeys.length === 0 || textNodes.length === 0) return

    interface WordInfo {
      word: string
      regex: RegExp
      decoration: string
    }

    const wordInfos: WordInfo[] = wordKeys
      .map(word => ({
        word,
        regex: new RegExp(
          `\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
          'gi'
        ),
        decoration: this.getTextDecoration(wordDict[word]),
      }))
      .sort((a, b) => b.word.length - a.word.length) // Longest first

    console.log(`Collected ${textNodes.length} text nodes for processing`)

    interface NodeReplacement {
      node: Text
      newContent: string
    }

    const replacements: NodeReplacement[] = []
    let totalReplacements = 0

    textNodes.forEach(textNode => {
      let text = textNode.textContent || ''
      let hasChanges = false

      // Use placeholders to avoid nested replacements
      const placeholders: { placeholder: string; html: string }[] = []
      let placeholderIndex = 0

      wordInfos.forEach(({ word, regex, decoration }) => {
        if (regex.test(text)) {
          text = text.replace(regex, match => {
            totalReplacements++
            hasChanges = true

            const placeholder = `___ENX_PLACEHOLDER_${placeholderIndex++}___`
            const html = `<u class="enx-word enx-${word.toLowerCase()}" data-word="${match}" style="display: inline !important; text-decoration: ${decoration}; text-decoration-thickness: 1px;">${match}</u>`

            placeholders.push({ placeholder, html })
            return placeholder
          })
          regex.lastIndex = 0
        }
      })

      if (hasChanges) {
        placeholders.forEach(({ placeholder, html }) => {
          text = text.replace(placeholder, html)
        })
        replacements.push({ node: textNode, newContent: text })
      }
    })

    console.log(
      `Found ${replacements.length} nodes to replace with ${totalReplacements} total word matches`
    )

    // Batch DOM updates using DocumentFragment for better performance
    replacements.forEach(({ node, newContent }) => {
      const tempContainer = document.createElement('span')
      tempContainer.innerHTML = newContent

      const fragment = document.createDocumentFragment()
      while (tempContainer.firstChild) {
        fragment.appendChild(tempContainer.firstChild)
      }

      const parent = node.parentNode
      if (parent) {
        parent.replaceChild(fragment, node)
      }
    })

    console.log('Word highlighting optimization completed')
  }

  // ---------------------------------------------------------------------------
  // CSS Custom Highlight API path (ADR-011 Decision 1). No DOM mutation: the
  // underline is painted over Ranges, not written as elements. These methods
  // are additive for now -- ticket #11 wires them in and removes the
  // element-wrapping ones above.
  // ---------------------------------------------------------------------------

  private static readonly ALPHA_SEGMENT = /^[A-Za-z]+$/

  // Splits `text` into word tokens with their offsets, aligned with the keys
  // extractWords() produces (which is what wordDict is keyed by). ICU word
  // segmentation is the base; two adjustments make the tokens line up:
  //   - drop segments with no ASCII letter (numbers, symbols) -- extractWords
  //     rejects them too;
  //   - rejoin `-<word>` runs so "well-known" / "state-of-the-art" stay whole
  //     (ICU splits on the hyphen), but ONLY across letter-only segments, so
  //     "COVID-19" / "Catch-22" tokenize to "covid" / "catch" -- which is
  //     exactly what extractWords' letter-bounded pattern yields.
  private static tokenizeWords(
    text: string
  ): { word: string; start: number; end: number }[] {
    if (!text) return []
    const segments = [...this.wordSegmenter.segment(text)]
    const tokens: { word: string; start: number; end: number }[] = []

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      if (!seg.isWordLike || !/[a-zA-Z]/.test(seg.segment)) continue

      let end = seg.index + seg.segment.length
      while (
        segments[i + 1]?.segment === '-' &&
        segments[i + 1].index === end &&
        segments[i + 2]?.index === end + 1 &&
        this.ALPHA_SEGMENT.test(segments[i + 2].segment)
      ) {
        end = segments[i + 2].index + segments[i + 2].segment.length
        i += 2
      }

      tokens.push({ word: text.slice(seg.index, end), start: seg.index, end })
    }
    return tokens
  }

  // A DOM Range spanning `token` within `node` (a text node).
  private static rangeForToken(
    node: Node,
    token: { start: number; end: number }
  ): Range {
    const range = document.createRange()
    range.setStart(node, token.start)
    range.setEnd(node, token.end)
    return range
  }

  // For the click-to-lookup path (ADR-011 Decision 2): given the caret
  // position from caretPositionFromPoint (a text node + character offset),
  // return a Range spanning the whole word the caret is inside -- or null if
  // the caret isn't in a word, or sits inside an excluded subtree
  // (link / button / code / ...). Never touches the DOM.
  static expandToWordRange(node: Node, offset: number): Range | null {
    if (node.nodeType !== Node.TEXT_NODE) return null
    if (this.isInExcludedSubtree(node)) return null

    const token = this.tokenizeWords(node.textContent || '').find(
      t => offset >= t.start && offset <= t.end
    )
    return token ? this.rangeForToken(node, token) : null
  }

  // Builds the Ranges to highlight from an already-collected text-node list
  // (collectTextNodes), grouped by review-stage bucket. Words not in
  // `wordDict`, and words reviewBucket() rejects, produce no Range.
  static buildHighlightRanges(
    textNodes: Text[],
    wordDict: Record<string, WordData>
  ): Map<number, Range[]> {
    const buckets = new Map<number, Range[]>()
    if (Object.keys(wordDict).length === 0) return buckets

    for (const node of textNodes) {
      for (const token of this.tokenizeWords(node.textContent || '')) {
        const data = wordDict[token.word.toLowerCase()]
        if (!data) continue
        const bucket = this.reviewBucket(data)
        if (bucket === null) continue

        const range = this.rangeForToken(node, token)

        const existing = buckets.get(bucket)
        if (existing) existing.push(range)
        else buckets.set(bucket, [range])
      }
    }
    return buckets
  }

  // Registers each bucket's Ranges as a named CSS.highlights entry, replacing
  // any ENX highlights already registered.
  static applyHighlights(buckets: Map<number, Range[]>): void {
    this.clearHighlights()
    for (const [bucket, ranges] of buckets) {
      if (ranges.length === 0) continue
      CSS.highlights.set(
        `${this.HIGHLIGHT_NAME_PREFIX}${bucket}`,
        new Highlight(...ranges)
      )
    }
  }

  // Removes every ENX highlight from the registry, leaving any highlights the
  // host page registered untouched. This is all `disableEnx` needs to do.
  static clearHighlights(): void {
    for (const name of [...CSS.highlights.keys()]) {
      if (name.startsWith(this.HIGHLIGHT_NAME_PREFIX)) {
        CSS.highlights.delete(name)
      }
    }
  }

  // Re-derives every highlight over `root` from `wordDict` + the current DOM.
  // Safe to call at any time -- there is no self-inflicted DOM mutation to
  // filter out, so a full rebuild is the whole story (ADR-011 F section).
  static rebuildHighlights(
    root: Node,
    wordDict: Record<string, WordData>
  ): void {
    this.applyHighlights(
      this.buildHighlightRanges(this.collectTextNodes(root), wordDict)
    )
  }

  // Returns every element on the page that should be treated as article
  // content. A selector can match more than one element (e.g. a short
  // intro block and the real article body sharing the same class) — all
  // of them get processed, not just the longest one.
  //
  // ADR-010: `options` carries the SiteAdapter's overrides. With no options
  // (or the default adapter's values) this behaves exactly as before —
  // built-in selector list, ">100 chars" threshold, largest-container
  // fallback, every match returned. A `contentSelector` replaces the built-in
  // list and disables the fallback; `focusedNodeResolver` narrows the winning
  // selector's matches.
  static getArticleNodes(options?: {
    contentSelector?: string
    minTextLength?: number
    focusedNodeResolver?: (nodes: Element[]) => Element[]
  }): Element[] {
    const minTextLength = options?.minTextLength ?? 100
    const focus = options?.focusedNodeResolver ?? ((nodes: Element[]) => nodes)

    const selectors = options?.contentSelector
      ? [options.contentSelector]
      : [
          '.Article', // BBC
          '.article__data', // InfoQ
          '.blog_post_content_wrap', // Claude blog (Webflow)
          '.post-content', // Blog posts
          '.single-post__container', // Microsoft Research
          '#EMAIL_CONTAINER', // NY Times
          '.text', // TingRoom
          '#lesson-main-content', // Anthropic Skilljar
          '.sjwc-lesson-content-item', // Anthropic Skilljar (inner)
          'article', // Semantic HTML5
          '.content',
          '.entry-content',
          '.post-body',
        ]

    for (const selector of selectors) {
      const matches = Array.from(document.querySelectorAll(selector)).filter(
        element => (element.textContent?.trim().length || 0) > minTextLength
      )
      // Drop matches nested inside another match, so the same text isn't processed twice.
      const nodes = matches.filter(
        element => !matches.some(other => other !== element && other.contains(element))
      )

      if (nodes.length > 0) {
        console.log(`✅ Using article node with selector: ${selector}`)
        return focus(nodes)
      }
    }

    // A SiteAdapter that pins its own selector opts out of the guess-y
    // fallback: "no node found" is a clean degradation there (ADR-010).
    if (options?.contentSelector) {
      return []
    }

    // Fallback: find the largest text container on the page
    const allElements = document.querySelectorAll('div, main, section, article')
    let largestElement: Element | null = null
    let maxTextLength = 0

    allElements.forEach(element => {
      const textLength = element.textContent?.length || 0
      if (textLength > maxTextLength && textLength > 500) {
        maxTextLength = textLength
        largestElement = element
      }
    })

    if (largestElement) {
      console.log(`✅ Fallback: Using largest element with ${maxTextLength} characters`)
      return [largestElement]
    }

    return []
  }

  // Strips <script>/<style>/<noscript> before reading textContent, so their
  // contents don't get picked up as word candidates by extractWords().
  static cleanArticleText(articleNode: Element): string {
    const clone = articleNode.cloneNode(true) as Element
    clone.querySelectorAll('script, style, noscript').forEach(el => el.remove())
    return clone.textContent || ''
  }

  // Intl.Segmenter has a known "Maximum call stack exceeded" failure mode on
  // very long strings (~40-50k+ chars) and slows down on heavy non-ASCII
  // text. If the sentence container is unexpectedly huge (e.g. `closest()`
  // walked all the way up to a wrapper that holds a whole article), segment
  // only a window around the clicked word instead of the entire container.
  static readonly MAX_SEGMENT_LENGTH = 5000
  static readonly SEGMENT_WINDOW_RADIUS = 500

  // Walks up from a starting node looking for the nearest block-level
  // ancestor whose text is long enough to plausibly contain a full sentence.
  // Mirrors getArticleNodes()'s ">20/100/500 chars" style thresholds, just
  // at paragraph granularity instead of article granularity.
  private static findSentenceContainer(startNode: Node): Element | null {
    const blockSelector = 'p, li, blockquote, td, div'
    let current = nearestElement(startNode)?.closest(blockSelector) || null

    while (current) {
      const length = current.textContent?.trim().length || 0
      if (length > 20) {
        return current
      }
      current = current.parentElement?.closest(blockSelector) || null
    }

    return null
  }

  // Range start -> character offset within container's flattened textContent.
  // This is what lets duplicate occurrences of the same word in one paragraph
  // resolve to the sentence that was actually clicked, instead of always
  // matching the first occurrence via indexOf(). Using the range's own start
  // (rather than "before the wrapping element") stays accurate whether the
  // caller passed a range over an element or a raw text-node position, and
  // isn't thrown off by whitespace around a wrapper.
  private static getTextOffsetWithin(container: Element, reference: Range): number {
    const range = document.createRange()
    range.selectNodeContents(container)
    range.setEnd(reference.startContainer, reference.startOffset)
    return range.toString().length
  }

  // From a Range marking where the user clicked or started a selection,
  // locates the sentence it belongs to. Returns null only when no plausible
  // sentence container can be found at all; once a container is found,
  // segmentation failures degrade to returning the container's full text
  // rather than null, so the feature stays usable even when sentence-boundary
  // detection can't help. (ADR-011 Decision 5: was element-based.)
  // `queryText` is the single word (click / one-word selection) or the whole
  // phrase (2-5 word selection, ADR-008) the sentence is being fetched for --
  // used only for the sanity-check warning below.
  static extractSentenceContext(
    reference: Range,
    queryText: string
  ): { sentence: string; sentenceIndex: number } | null {
    const container = this.findSentenceContainer(reference.startContainer)
    if (!container) return null

    const fullText = container.textContent || ''
    if (fullText.trim().length === 0) return null

    const offset = this.getTextOffsetWithin(container, reference)

    let textToSegment = fullText
    let baseOffset = offset
    if (fullText.length > this.MAX_SEGMENT_LENGTH) {
      const start = Math.max(0, offset - this.SEGMENT_WINDOW_RADIUS)
      const end = Math.min(fullText.length, offset + this.SEGMENT_WINDOW_RADIUS)
      textToSegment = fullText.slice(start, end)
      baseOffset = offset - start
    }

    let result: { sentence: string; sentenceIndex: number } | null = null

    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter !== 'undefined') {
      try {
        const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })
        const segments = [...segmenter.segment(textToSegment)]

        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i]
          const segmentEnd = segment.index + segment.segment.length
          if (baseOffset >= segment.index && baseOffset < segmentEnd) {
            result = { sentence: segment.segment.trim(), sentenceIndex: i }
            break
          }
        }
      } catch (error) {
        console.warn('extractSentenceContext: Intl.Segmenter failed, falling back to full text', error)
      }
    }

    if (!result) {
      result = { sentence: textToSegment.trim(), sentenceIndex: 0 }
    }

    // Sanity check only, not a correctness gate: if the DOM-offset math ever
    // drifts, this surfaces it in the console instead of silently returning
    // an unrelated sentence. Only checked for single words -- a phrase
    // selection needn't appear verbatim in the segmented sentence (whitespace
    // normalisation, spanning a boundary), so an exact-substring test there
    // would just be noise.
    const isSingleWord = !/\s/.test(queryText.trim())
    if (
      isSingleWord &&
      !result.sentence.toLowerCase().includes(queryText.toLowerCase())
    ) {
      console.warn(
        `extractSentenceContext: resolved sentence does not contain "${queryText}"`,
        result.sentence
      )
    }

    return result
  }
}
