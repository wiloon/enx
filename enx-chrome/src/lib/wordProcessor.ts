import { WordData } from '@/types'
import { nearestElement } from '@/lib/rangeUtils'
import {
  HIGHLIGHT_BUCKET_COLORS,
  HIGHLIGHT_NAME_PREFIX,
  REVIEW_BUCKET_COUNT,
  isReviewable,
  reviewBucket,
  tokenizeWords,
} from '@/lib/wordHighlight'

export interface LookupAreaOptions {
  contentSelector?: string
  minTextLength?: number
  focusedNodeResolver?: (nodes: Element[]) => Element[]
}

export interface LookupArea {
  nodes: Element[]
  source: 'article' | 'whole-page'
}

// Single source of truth for article extraction / word highlighting.
// content.tsx and its tests import this instead of keeping their own copies.
export class WordProcessor {
  static readonly WORD_PATTERNS = {
    contractedWord: /\b[a-zA-Z][a-zA-Z'''-]*[a-zA-Z]\b|\b[a-zA-Z]\b/g,
    htmlTag: /<[^>]*>/g,
    htmlEntity: /&[a-zA-Z0-9#]+;/g,
  }

  // getArticleNodes()'s largest-text fallback rejects a candidate whose
  // link-to-text ratio exceeds this (adr-034 Decision 3).
  static readonly LINK_DENSITY_THRESHOLD = 0.5

  // The largest-text fallback ignores candidates with this much text or
  // less, and takes the whole body only when its lookup-eligible text is
  // longer than this.
  static readonly FALLBACK_MIN_TEXT_LENGTH = 500

  // The largest-text fallback takes the whole body when its best candidate
  // holds less than this share of the body's visible text: the paragraphs sit
  // directly under <body> (#565). A starting value from a 20-page sample.
  static readonly BODY_FALLBACK_MAX_CANDIDATE_SHARE = 0.25

  // Ancestor tags whose text is never looked up or highlighted (links,
  // form controls, code). Shared by collectTextNodes (highlight + extract
  // path) and expandToWordRange (click path) so their exclusion rules can't
  // drift apart (ADR-010 §1.3 / ADR-011 Decision 2). A click on summary or
  // label text keeps its default action (toggling a details, focusing a
  // field) because no lookup claims it.
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
    'summary',
    'label',
  ]

  // Whole subtrees skipped by selector, for chrome the tag list can't reach:
  // an X Article code block keeps its <pre><code> body in the tag list above,
  // but its "plaintext" language label sits beside it in a plain <span>.
  static readonly LOOKUP_EXCLUDED_SELECTORS = [
    '[data-testid="markdown-code-block"]',
    // The extension's own UI inserted into the page (content.tsx sets
    // data-enx-ui on it), e.g. the session-expired notice.
    '[data-enx-ui]',
  ]

  // Review-stage highlight names and palette (ADR-011 Decision 1 / E1),
  // shared with the Side Panel via wordHighlight.ts (ADR-053).
  static readonly HIGHLIGHT_NAME_PREFIX = HIGHLIGHT_NAME_PREFIX
  static readonly HIGHLIGHT_BUCKET_COLORS = HIGHLIGHT_BUCKET_COLORS
  static readonly REVIEW_BUCKET_COUNT = REVIEW_BUCKET_COUNT

  // Marks the sentence a word-click just opened the sentence panel for
  // (ADR-025), so the user can find it again after returning from the side
  // panel. Deliberately outside HIGHLIGHT_NAME_PREFIX: the paint window
  // adds, moves and removes enx-hl-* entries as blocks scroll by and words
  // change review bucket, and must never touch this one.
  static readonly ACTIVE_SENTENCE_HIGHLIGHT_NAME = 'enx-active-sentence'

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

  static isReviewable(wordData: WordData): boolean {
    return isReviewable(wordData)
  }

  static reviewBucket(wordData: WordData): number | null {
    return reviewBucket(wordData)
  }

  // The eligible-text-node filter, shared by word extraction and highlight
  // range building (ADR-010 Decision 3 / ADR-011). Skips
  // LOOKUP_EXCLUDED_TAGS and LOOKUP_EXCLUDED_SELECTORS subtrees and text with
  // no Latin letters. Keeping extraction and highlighting on
  // this single traversal is what stops their filter rules from drifting
  // apart (ADR-010 §1.3).
  //
  // True when `node` sits inside a LOOKUP_EXCLUDED_TAGS subtree (walking up
  // to, but not including, `root`), or inside an `adapterExclusions` match
  // anywhere above it, `root` and its ancestors included (the SiteAdapter's
  // lookupExcludedSelectors).
  static isInExcludedSubtree(
    node: Node,
    root?: Node,
    adapterExclusions: readonly string[] = []
  ): boolean {
    let current: HTMLElement | null = node.parentElement
    while (current && current !== root) {
      if (
        this.LOOKUP_EXCLUDED_TAGS.includes(current.tagName.toLowerCase()) ||
        this.LOOKUP_EXCLUDED_SELECTORS.some(selector =>
          current!.matches(selector)
        )
      ) {
        return true
      }
      current = current.parentElement
    }
    return (
      adapterExclusions.length > 0 &&
      node.parentElement?.closest(adapterExclusions.join(', ')) != null
    )
  }

  static collectTextNodes(
    root: Node,
    adapterExclusions: readonly string[] = []
  ): Text[] {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: node => {
        if (!node.parentElement) return NodeFilter.FILTER_REJECT
        if (
          this.isInExcludedSubtree(
            node,
            adapterExclusions.length > 0 ? undefined : root,
            adapterExclusions
          )
        )
          return NodeFilter.FILTER_REJECT

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

  // ---------------------------------------------------------------------------
  // CSS Custom Highlight API path (ADR-011 Decision 1). No DOM mutation: the
  // underline is painted over Ranges, not written as elements.
  // ---------------------------------------------------------------------------

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
  static expandToWordRange(
    node: Node,
    offset: number,
    adapterExclusions: readonly string[] = []
  ): Range | null {
    if (node.nodeType !== Node.TEXT_NODE) return null
    if (this.isInExcludedSubtree(node, undefined, adapterExclusions))
      return null

    const token = tokenizeWords(node.textContent || '').find(
      t => offset >= t.start && offset <= t.end
    )
    return token ? this.rangeForToken(node, token) : null
  }

  // ADR-025: single-Range highlight for "the sentence a word click just
  // opened the sentence panel for". Replaces whatever was previously active
  // -- only the most recently queried sentence stays marked.
  static setActiveSentenceHighlight(range: Range): void {
    CSS.highlights.set(
      this.ACTIVE_SENTENCE_HIGHLIGHT_NAME,
      new Highlight(range)
    )
  }

  static clearActiveSentenceHighlight(): void {
    CSS.highlights.delete(this.ACTIVE_SENTENCE_HIGHLIGHT_NAME)
  }

  // Fraction of `element`'s text that sits inside <a> tags -- high for nav
  // bars, related-link lists and comment threads, low for article prose
  // (adr-034 Decision 3).
  static linkDensity(element: Element): number {
    const totalLength = element.textContent?.length || 0
    if (totalLength === 0) return 0

    let linkLength = 0
    element.querySelectorAll('a').forEach(a => {
      linkLength += a.textContent?.length || 0
    })

    return linkLength / totalLength
  }

  // The built-in selector list, in priority order (adr-034 #563 amendment).
  // A precise selector names the article itself: any match with more than
  // one character of text counts. A broad selector is a generic class that
  // also lands on small widgets: it keeps the adapter's minimum and only its
  // longest match is taken.
  private static readonly BUILT_IN_SELECTORS: ReadonlyArray<{
    selector: string
    broad?: true
  }> = [
    { selector: '.Article' }, // BBC
    { selector: '.article__data' }, // InfoQ
    { selector: '.blog_post_content_wrap' }, // Claude blog (Webflow)
    { selector: '.post-content', broad: true }, // Blog posts
    { selector: '.single-post__container' }, // Microsoft Research
    { selector: '#EMAIL_CONTAINER' }, // NY Times
    { selector: '#lesson-main-content' }, // Anthropic Skilljar
    { selector: '.sjwc-lesson-content-item' }, // Anthropic Skilljar (inner)
    { selector: 'article' }, // Semantic HTML5
    { selector: '.content', broad: true },
    { selector: '.entry-content', broad: true },
    { selector: '.post-body', broad: true },
    // Last, so article and the broad selectors win on pages that have them.
    { selector: 'main' },
  ]

  // A precise selector's match counts when its trimmed text is longer than
  // this, the rule the X, RSSX and Reader adapters use.
  private static readonly PRECISE_MIN_TEXT_LENGTH = 1

  // Returns every element on the page that should be treated as the lookup
  // area. A selector can match more than one element (e.g. a short intro
  // block and the real article body sharing the same class) — all of them get
  // processed, not just the longest one; broad selectors are the exception.
  //
  // ADR-010: `options` carries the SiteAdapter's overrides. A
  // `contentSelector` replaces the built-in list and disables both fallbacks;
  // `minTextLength` is the minimum for it or for the broad selectors;
  // `focusedNodeResolver` narrows the winning selector's matches.
  static getArticleNodes(options?: LookupAreaOptions): Element[] {
    return this.findLookupArea(options).nodes
  }

  // The nodes lookup and highlighting run in, and where they came from:
  // 'article' when a selector or the largest-text fallback found the article
  // (reading statistics count it, ADR-028), 'whole-page' when nothing did and
  // the body is the lookup area only as a last resort (adr-034 #563). An
  // adapter with a contentSelector never falls back: it gets 'article' with
  // its matches, possibly none.
  static findLookupArea(options?: LookupAreaOptions): LookupArea {
    const minTextLength = options?.minTextLength ?? 100
    const focus = options?.focusedNodeResolver ?? ((nodes: Element[]) => nodes)
    const article = (nodes: Element[]): LookupArea => ({
      nodes,
      source: 'article',
    })

    const selectors: Array<{
      selector: string
      minLength: number
      longestOnly: boolean
    }> = options?.contentSelector
      ? [
          {
            selector: options.contentSelector,
            minLength: minTextLength,
            longestOnly: false,
          },
        ]
      : this.BUILT_IN_SELECTORS.map(({ selector, broad }) => ({
          selector,
          minLength: broad ? minTextLength : this.PRECISE_MIN_TEXT_LENGTH,
          longestOnly: broad === true,
        }))

    for (const { selector, minLength, longestOnly } of selectors) {
      const matches = Array.from(document.querySelectorAll(selector)).filter(
        element => (element.textContent?.trim().length || 0) > minLength
      )
      // Drop matches nested inside another match, so the same text isn't processed twice.
      let nodes = matches.filter(
        element =>
          !matches.some(other => other !== element && other.contains(element))
      )
      if (longestOnly && nodes.length > 1) {
        nodes = [this.longestText(nodes)]
      }

      if (nodes.length > 0) {
        console.log(`✅ Using article node with selector: ${selector}`)
        return article(focus(nodes))
      }
    }

    // A SiteAdapter that pins its own selector opts out of the guess-y
    // fallback: "no node found" is a clean degradation there (ADR-010).
    if (options?.contentSelector) {
      return article([])
    }

    const largest = this.largestTextBlock()
    if (largest.length > 0) return article(largest)

    if (document.body) {
      console.log('✅ Whole page: no article node found, using body')
      return { nodes: [document.body], source: 'whole-page' }
    }
    return article([])
  }

  private static longestText(nodes: Element[]): Element {
    return nodes.reduce((longest, node) =>
      (node.textContent?.trim().length || 0) >
      (longest.textContent?.trim().length || 0)
        ? node
        : longest
    )
  }

  // The largest-text fallback: one container, the body (#565), or none.
  private static largestTextBlock(): Element[] {
    // Fallback: find the largest text container on the page, skipping
    // candidates whose text is mostly inside <a> tags (nav, related-links,
    // comment threads) -- adr-034 Decision 3. Threshold is a starting point,
    // tunable against real sites; not meant to be precise on day one.
    const allElements = document.querySelectorAll('div, main, section, article')
    let largestElement: Element | null = null
    let maxTextLength = 0

    allElements.forEach(element => {
      const textLength = element.textContent?.length || 0
      if (
        textLength <= maxTextLength ||
        textLength <= this.FALLBACK_MIN_TEXT_LENGTH
      ) {
        return
      }
      if (this.linkDensity(element) > this.LINK_DENSITY_THRESHOLD) return
      maxTextLength = textLength
      largestElement = element
    })

    const body = document.body
    if (body && this.bodyIsTheArticle(body, largestElement)) {
      console.log('✅ Fallback: Using body, no container holds the article')
      return [body]
    }

    if (largestElement) {
      console.log(
        `✅ Fallback: Using largest element with ${maxTextLength} characters`
      )
      return [largestElement]
    }

    return []
  }

  // The largest-text fallback's body test (#565). `candidate` is the winner
  // picked on raw text, or null. Share and body link density are measured on
  // visible text: inline scripts can outweigh a page's prose many times over.
  private static bodyIsTheArticle(
    body: HTMLElement,
    candidate: Element | null
  ): boolean {
    const visibleBody = this.withoutNonContent(body)
    const bodyLength = visibleBody.textContent?.length || 0
    const candidateShare =
      candidate && bodyLength > 0
        ? this.cleanArticleText(candidate).length / bodyLength
        : 0
    if (candidateShare >= this.BODY_FALLBACK_MAX_CANDIDATE_SHARE) return false
    if (this.linkDensity(visibleBody) > this.LINK_DENSITY_THRESHOLD)
      return false

    const eligibleLength = this.collectTextNodes(body).reduce(
      (sum, node) => sum + node.data.length,
      0
    )
    return eligibleLength > this.FALLBACK_MIN_TEXT_LENGTH
  }

  // A detached copy of `element` without its <script>/<style>/<noscript>
  // subtrees.
  private static withoutNonContent(element: Element): Element {
    const clone = element.cloneNode(true) as Element
    clone.querySelectorAll('script, style, noscript').forEach(el => el.remove())
    return clone
  }

  // Strips <script>/<style>/<noscript> before reading textContent, so their
  // contents don't get picked up as word candidates by extractWords().
  static cleanArticleText(articleNode: Element): string {
    return this.withoutNonContent(articleNode).textContent || ''
  }

  // Intl.Segmenter has a known "Maximum call stack exceeded" failure mode on
  // very long strings (~40-50k+ chars) and slows down on heavy non-ASCII
  // text. If the sentence container is unexpectedly huge (e.g. `closest()`
  // walked all the way up to a wrapper that holds a whole article), segment
  // only a window around the clicked word instead of the entire container.
  static readonly MAX_SEGMENT_LENGTH = 5000
  static readonly SEGMENT_WINDOW_RADIUS = 500

  // UAX #29 breaks a sentence after every one of these (rule SB4), yet with
  // `white-space: normal` the browser renders them as plain spaces, so
  // hard-wrapped page source would split prose at every source line.
  private static readonly LINE_SEPARATORS = /[\n\r\x85\u2028\u2029]/g
  // `\s` and String.prototype.trim() don't treat NEL (U+0085) as whitespace.
  private static readonly SEPARATOR_RUN = /[\s\x85]+/g
  private static readonly LEADING_SEPARATORS = /^[\s\x85]*/
  private static readonly TRAILING_SEPARATORS = /[\s\x85]*$/

  // The sentence as rendered: every whitespace or separator run is one space.
  private static normalizeSentence(text: string): string {
    return text.replace(this.SEPARATOR_RUN, ' ').trim()
  }

  // The range over fullText[start, end), trimmed of leading/trailing
  // whitespace and NEL so the highlight doesn't paint the gap around it.
  private static trimmedRange(
    container: Element,
    fullText: string,
    start: number,
    end: number
  ): Range | null {
    const span = fullText.slice(start, end)
    const leading = this.LEADING_SEPARATORS.exec(span)![0].length
    const trailing = this.TRAILING_SEPARATORS.exec(span)![0].length
    const trimmedStart = start + leading
    const trimmedEnd = end - trailing
    return trimmedEnd > trimmedStart
      ? this.rangeFromContainerOffsets(container, trimmedStart, trimmedEnd)
      : null
  }

  // Walks up from a starting node looking for the nearest block-level
  // ancestor whose text is long enough to plausibly contain a full sentence.
  // Mirrors getArticleNodes()'s ">20/100/500 chars" style thresholds, just
  // at paragraph granularity instead of article granularity.
  // A heading is one self-contained unit: it is returned whole, never split
  // into sentences, and never measured against the 20-character minimum
  // ("Conclusion" is a real heading). Without this a heading in no block
  // container came back as just the clicked word, and one in a wrapper div
  // was glued to the next paragraph when the markup had no whitespace
  // between them -- textContent has no line break there.
  private static readonly HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6'

  private static findSentenceContainer(startNode: Node): Element | null {
    const heading = nearestElement(startNode)?.closest(this.HEADING_SELECTOR)
    if (heading) return heading

    // The minimum length skips small wrappers (a div around one link or tag,
    // a short menu item) on the way up to the element holding the prose.
    // With no block over it, the nearest block is the sentence however short
    // ("By Joseph Conrad." on a title page, #563).
    const blockSelector = 'p, li, blockquote, td, div'
    const nearest = nearestElement(startNode)?.closest(blockSelector) || null
    let current = nearest

    while (current) {
      const length = current.textContent?.trim().length || 0
      if (length > 20) {
        return current
      }
      current = current.parentElement?.closest(blockSelector) || null
    }

    return nearest
  }

  // Range start -> character offset within container's flattened textContent.
  // This is what lets duplicate occurrences of the same word in one paragraph
  // resolve to the sentence that was actually clicked, instead of always
  // matching the first occurrence via indexOf(). Using the range's own start
  // (rather than "before the wrapping element") stays accurate whether the
  // caller passed a range over an element or a raw text-node position, and
  // isn't thrown off by whitespace around a wrapper.
  private static getTextOffsetWithin(
    container: Element,
    reference: Range
  ): number {
    const range = document.createRange()
    range.selectNodeContents(container)
    range.setEnd(reference.startContainer, reference.startOffset)
    return range.toString().length
  }

  // Inverse of getTextOffsetWithin: [start, end) character offsets into
  // container's flattened textContent -> a Range spanning that text, by
  // walking the container's text nodes and locating the ones the offsets
  // fall in. Returns null if the offsets don't resolve to real text nodes
  // (container's live text no longer matches the offsets it was computed
  // from -- shouldn't happen since callers use it synchronously).
  private static rangeFromContainerOffsets(
    container: Element,
    start: number,
    end: number
  ): Range | null {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    let consumed = 0
    let startNode: Text | null = null
    let startOffset = 0
    let endNode: Text | null = null
    let endOffset = 0
    let node: Node | null

    while ((node = walker.nextNode())) {
      const text = node as Text
      const nodeEnd = consumed + text.data.length

      if (startNode === null && start <= nodeEnd) {
        startNode = text
        startOffset = Math.max(0, start - consumed)
      }
      if (end <= nodeEnd) {
        endNode = text
        endOffset = Math.max(0, end - consumed)
        break
      }
      consumed = nodeEnd
    }

    if (!startNode || !endNode) return null

    const range = document.createRange()
    range.setStart(startNode, startOffset)
    range.setEnd(endNode, endOffset)
    return range
  }

  // Builds the string Intl.Segmenter runs sentence-break detection against:
  // same length and content as `fullText`, except every character inside a
  // LOOKUP_EXCLUDED_TAGS span (code, pre, ...) is replaced with a neutral
  // letter. Segment boundaries computed from this string index directly into
  // `fullText` unchanged, since lengths match; only the punctuation the
  // segmenter sees is different. Every LINE_SEPARATORS character is also
  // replaced with a space, one for one. Falls back to `fullText` (with the
  // same separator replacement) if the walked length ever disagrees with it
  // (shouldn't happen -- textContent is defined as the concatenation of the
  // same text nodes -- but a mismatch would silently corrupt every offset
  // downstream, so it's worth guarding).
  private static buildSegmentationText(
    container: Element,
    fullText: string
  ): string {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    let masked = ''
    let node: Node | null
    while ((node = walker.nextNode())) {
      const text = (node as Text).data
      masked += this.isInExcludedSubtree(node, container)
        ? 'x'.repeat(text.length)
        : text
    }
    const segmentable = masked.length === fullText.length ? masked : fullText
    return segmentable.replace(this.LINE_SEPARATORS, ' ')
  }

  // The whole container as the sentence, normalized and with its range
  // trimmed the same way a segmented sentence's is.
  private static wholeContainerContext(
    container: Element,
    fullText: string
  ): { sentence: string; sentenceIndex: number; range: Range | null } {
    return {
      sentence: this.normalizeSentence(fullText),
      sentenceIndex: 0,
      range: this.trimmedRange(container, fullText, 0, fullText.length),
    }
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
  // `range` (ADR-025) spans the resolved sentence in the live DOM, trimmed of
  // its leading/trailing whitespace and NEL, for setActiveSentenceHighlight().
  // null when the offsets can't be resolved back to text nodes. `sentence` is
  // that text with every whitespace run collapsed to one space.
  static extractSentenceContext(
    reference: Range,
    queryText: string
  ): { sentence: string; sentenceIndex: number; range: Range | null } | null {
    const container = this.findSentenceContainer(reference.startContainer)
    if (!container) return null

    const fullText = container.textContent || ''
    if (fullText.trim().length === 0) return null

    if (container.matches(this.HEADING_SELECTOR)) {
      return this.wholeContainerContext(container, fullText)
    }

    // Inline <code>/<pre> spans (e.g. `<?start>`, `<?end>`) hold literal
    // syntax whose punctuation ICU's sentence-break rules mistake for real
    // sentence terminators, fracturing one prose sentence into several at
    // each false "?"/"." inside the code span. Segmentation runs against a
    // same-length masked copy with those spans blanked out instead, so
    // boundaries land only on the surrounding prose; the returned sentence
    // text always comes from `fullText`, never from the masked copy.
    const segmentationText = this.buildSegmentationText(container, fullText)

    const offset = this.getTextOffsetWithin(container, reference)

    let textToSegment = segmentationText
    let baseOffset = offset
    let windowStart = 0
    if (segmentationText.length > this.MAX_SEGMENT_LENGTH) {
      windowStart = Math.max(0, offset - this.SEGMENT_WINDOW_RADIUS)
      const end = Math.min(
        segmentationText.length,
        offset + this.SEGMENT_WINDOW_RADIUS
      )
      textToSegment = segmentationText.slice(windowStart, end)
      baseOffset = offset - windowStart
    }

    let result: {
      sentence: string
      sentenceIndex: number
      start: number
      end: number
    } | null = null

    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter !== 'undefined') {
      try {
        const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })
        const segments = [...segmenter.segment(textToSegment)]

        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i]
          const segmentEnd = segment.index + segment.segment.length
          if (baseOffset >= segment.index && baseOffset < segmentEnd) {
            const start = windowStart + segment.index
            const end = windowStart + segmentEnd
            result = {
              sentence: this.normalizeSentence(fullText.slice(start, end)),
              sentenceIndex: i,
              start,
              end,
            }
            break
          }
        }
      } catch (error) {
        console.warn(
          'extractSentenceContext: Intl.Segmenter failed, falling back to full text',
          error
        )
      }
    }

    if (!result) {
      result = {
        sentence: this.normalizeSentence(
          fullText.slice(windowStart, windowStart + textToSegment.length)
        ),
        sentenceIndex: 0,
        start: windowStart,
        end: windowStart + textToSegment.length,
      }
    }

    const range = this.trimmedRange(
      container,
      fullText,
      result.start,
      result.end
    )

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

    return {
      sentence: result.sentence,
      sentenceIndex: result.sentenceIndex,
      range,
    }
  }
}
