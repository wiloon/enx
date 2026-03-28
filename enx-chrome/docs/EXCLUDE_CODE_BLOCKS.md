# Feature: Exclude Code Blocks from Word Highlighting

## Problem

When enx processes an article, it wraps recognized words in `<u class="enx-word ...">` elements to enable click-to-translate. This processing currently runs on **all text nodes** inside the article container, including text inside `<code>` and `<pre>` elements.

As a result, code snippets are visually modified (words underlined with color) and become clickable for translation, which:

- Corrupts the visual presentation of code blocks.
- Causes confusion — code identifiers, keywords, and symbols are not vocabulary words.
- May break copy-paste operations on code.
- Wastes API calls and processing resources — code tokens are not vocabulary and do not need translation.

### Affected HTML Example

Before enx processing:

```html
<code class="language-markup">yaml
BucketNamePrefix: 'amzn-s3-demo-bucket'
BucketNamespace: 'account-regional'
</code>
```

After enx processing (current, unwanted behavior):

```html
<code class=" language-markup">
  <u class="enx-word enx-yaml" ...>yaml</u>
  <u class="enx-word enx-bucketnameprefix" ...>BucketNamePrefix</u>: '...'
</code>
```

## Goal

Text nodes that are descendants of `<code>` or `<pre>` elements must be skipped during word highlighting. These elements are the standard HTML containers for inline code and code blocks respectively.

## Scope

- **File**: `enx-chrome/src/content/content.ts`
- **Class**: `ContentWordProcessor`
- **Method**: `renderWithHighlights` → the `TreeWalker` `acceptNode` filter

No other components need to change.

## Design

### Current Exclusion Logic (in `acceptNode`)

The `TreeWalker` currently walks up the ancestor chain and rejects text nodes whose ancestors are:

```
a, script, style, noscript, button, input, textarea, select
```

### Change: Add `code` and `pre` to the Exclusion List

Extend the excluded tag list to include `code` and `pre`:

```
a, script, style, noscript, button, input, textarea, select, code, pre
```

#### Why `pre` as well?

`<pre>` is the standard block-level container for preformatted text (including code blocks). It is almost always used to wrap `<code>`. Excluding `<pre>` ensures that even bare `<pre>text</pre>` without an inner `<code>` tag is also skipped.

### Code Diff (Pseudocode)

```diff
 if (
   [
     'a',
     'script',
     'style',
     'noscript',
     'button',
     'input',
     'textarea',
     'select',
+    'code',
+    'pre',
   ].includes(tagName)
 ) {
   return NodeFilter.FILTER_REJECT
 }
```

The ancestor-walking loop already exists; only the array contents need updating.

## Implementation Steps

1. Open `enx-chrome/src/content/content.ts`.
2. Locate the `acceptNode` callback inside `renderWithHighlights` — the array passed to `includes()`.
3. Add `'code'` and `'pre'` to that array.
4. Add automated test cases covering the scenarios in the Acceptance Criteria table to `src/content/__tests__/wordHighlighting.test.ts` (or a new `codeBlockExclusion.test.ts` file).
5. Run `pnpm test` inside `enx-chrome/` to confirm all tests pass.

## Test Cases

Add the following cases to the unit test suite (using the existing JSDOM + Jest setup):

```typescript
describe('Code block exclusion', () => {
  const wordDict = {
    yaml: { LoadCount: 5, AlreadyAcquainted: 0, WordType: 0, ... },
  }

  it('should NOT highlight words inside <code>', () => {
    const html = '<p>Read this: <code>yaml config</code></p>'
    const result = ContentWordProcessor.renderWithHighlights(html, wordDict)
    // <code> content must be untouched
    expect(result).toContain('<code>yaml config</code>')
    expect(result).not.toMatch(/<code>.*enx-word.*<\/code>/s)
  })

  it('should NOT highlight words inside <pre><code>', () => {
    const html = '<pre><code>yaml\nBucketNamePrefix: value</code></pre>'
    const result = ContentWordProcessor.renderWithHighlights(html, wordDict)
    expect(result).not.toContain('enx-word')
  })

  it('should NOT highlight words inside bare <pre>', () => {
    const html = '<pre>yaml config here</pre>'
    const result = ContentWordProcessor.renderWithHighlights(html, wordDict)
    expect(result).not.toContain('enx-word')
  })

  it('should still highlight words in <p> next to <code>', () => {
    const html = '<p>Read yaml docs</p><pre><code>yaml: value</code></pre>'
    const result = ContentWordProcessor.renderWithHighlights(html, wordDict)
    // <p> text should be highlighted
    expect(result).toMatch(/<p>.*enx-word.*<\/p>/s)
    // <code> text should NOT be highlighted
    expect(result).not.toMatch(/<code>.*enx-word.*<\/code>/s)
  })
})
```

## Acceptance Criteria

| Scenario | Expected Behavior |
|---|---|
| Plain article text | Words highlighted and clickable as before |
| Inline code `<code>word</code>` | No highlighting, no click handler |
| Block code `<pre><code>...</code></pre>` | No highlighting, no click handler |
| `<pre>` without inner `<code>` | No highlighting, no click handler |
| Nested structure: `<p>text <code>snippet</code> text</p>` | Only the `<p>` text nodes are highlighted; the `<code>` text node is skipped |

## Risk Assessment

- **Low risk**: The change is additive — it only enlarges the exclusion list.
- **No regressions expected**: `<code>` and `<pre>` content is never vocabulary learning material.
- **No API changes**: purely a DOM traversal filter adjustment.
