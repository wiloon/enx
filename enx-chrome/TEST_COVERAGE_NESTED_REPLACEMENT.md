# Nested Word Replacement Bug - Test Coverage

## Problem Summary

**Bug**: When highlighting multiple words, if a word appears in the HTML attribute of a previously highlighted word, it creates nested/malformed HTML.

**Example**:
- Highlighting "GitHub" creates: `<u class="enx-word" data-word="GitHub">GitHub</u>`
- Then highlighting "data" would match the `data` in `data-word="GitHub"`, creating:
  ```html
  <u class="enx-word" <u class="enx-word">data</u>-word="GitHub">GitHub</u>
  ```

**Root Cause**: Sequential regex replacements on the same string would match words inside previously generated HTML tags.

**Solution**: Use placeholder tokens (`___ENX_PLACEHOLDER_0___`, etc.) during replacement, then replace all placeholders with final HTML after all word matching is complete.

## Test Coverage

### File: `src/content/__tests__/htmlRendering.test.ts`

Added a new test suite: **"Nested Word Replacement - Bug Fix"** with 5 comprehensive tests:

### 1. `should not create nested highlights when word appears in HTML attribute`
**Purpose**: Reproduces the exact bug scenario where "data" appears in "data-word" attribute

**Test Cases**:
- Highlights "GitHub" first → creates `data-word="GitHub"` attribute
- Then highlights "data"
- **Buggy behavior**: Would create nested `<u>` tags
- **Fixed behavior**: Uses placeholders to avoid nesting

**Assertions**:
- ✅ Buggy approach produces nested tags
- ✅ Fixed approach with placeholders does NOT produce nested tags
- ✅ Final HTML has correct structure with 2 separate `<u>` elements

### 2. `should handle multiple words that could create nested replacements`
**Purpose**: Tests complex scenario with multiple overlapping words

**Test Data**:
```
"The event data architecture includes GitHub event handling"
Words: ["event", "data", "architecture", "GitHub"]
```

**Assertions**:
- ✅ All 5 occurrences highlighted (event appears twice)
- ✅ No nested `<u>` tags created
- ✅ No malformed HTML patterns like `<u ... <u ...>data</u>-word=`
- ✅ All `data-word` attributes properly formed
- ✅ Each element's `data-word` attribute matches its text content
- ✅ No nested `<u>` tags inside highlighted words

### 3. `should preserve word boundaries during placeholder replacement`
**Purpose**: Ensures word boundary regex works correctly with placeholders

**Test Data**: `"data dataset database"`

**Assertions**:
- ✅ Only "data" is highlighted (word boundary `\b`)
- ✅ "dataset" and "database" remain unchanged
- ✅ No partial word matches

### 4. `should not interfere with placeholder pattern in actual text`
**Purpose**: Edge case - what if actual text contains similar patterns?

**Test Data**: `"Some ___PLACEHOLDER___ text with data"`

**Assertions**:
- ✅ Original placeholder-like text preserved
- ✅ "data" is still correctly highlighted
- ✅ No interference between user text and internal placeholders

### 5. `should match the exact behavior from renderWithHighlights`
**Purpose**: Integration test matching real-world usage

**Test Data**: Simulates exact flow from `ContentWordProcessor.renderWithHighlights`
```
"GitHub announced during its annual event"
Words with LoadCount: GitHub(5), announced(10), during(0), its(0), annual(15), event(0)
```

**Assertions**:
- ✅ All 6 words highlighted
- ✅ Opening and closing tags count matches (6 each)
- ✅ No nested `<u>` tags
- ✅ All `data-word` attributes properly quoted
- ✅ Color codes correctly applied based on LoadCount

## Code Changes

### Modified: `src/content/content.ts`

**Before (Buggy)**:
```typescript
wordInfos.forEach(({ word, regex, colorCode }) => {
  if (regex.test(text)) {
    text = text.replace(regex, match => {
      return `<u class="enx-word" data-word="${match}">${match}</u>`
    })
  }
})
```

**After (Fixed)**:
```typescript
// Use placeholders to avoid nested replacements
const placeholders: { placeholder: string; html: string }[] = []
let placeholderIndex = 0

wordInfos.forEach(({ word, regex, colorCode }) => {
  if (regex.test(text)) {
    text = text.replace(regex, match => {
      const placeholder = `___ENX_PLACEHOLDER_${placeholderIndex++}___`
      const html = `<u class="enx-word" data-word="${match}">${match}</u>`
      placeholders.push({ placeholder, html })
      return placeholder  // Return placeholder, not HTML
    })
  }
})

// Replace all placeholders with actual HTML
placeholders.forEach(({ placeholder, html }) => {
  text = text.replace(placeholder, html)
})
```

## Test Results

```
✅ All 10 tests in htmlRendering.test.ts PASSED
✅ All 26 total unit tests PASSED
✅ All 16 E2E tests PASSED
```

## Real-world Verification

**Production Test**: InfoQ article with 603 words
- ✅ All words highlighted correctly
- ✅ No nested HTML tags
- ✅ No malformed attributes
- ✅ Clicking words shows correct translation popup

## Benefits

1. **Bug Prevention**: Tests catch regression if someone removes placeholder logic
2. **Edge Case Coverage**: Tests cover multiple overlapping scenarios
3. **Documentation**: Tests serve as examples of correct behavior
4. **Confidence**: 100% test pass rate ensures fix works correctly

## Future Improvements

Potential enhancements (not required now):
- Performance optimization: Use single regex pass instead of multiple
- More edge cases: Special characters, HTML entities, etc.
- Stress test: 1000+ words with many overlaps

---

**Date**: 2025-11-08
**Bug Fixed**: Nested word replacement in HTML attributes
**Tests Added**: 5 comprehensive test cases
**Status**: ✅ All tests passing
