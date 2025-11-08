# Content Script Tests

This directory contains tests for the content script functionality, particularly focusing on word highlighting and HTML rendering.

## Test Files

### `htmlRendering.test.ts` ✨ NEW

**Purpose**: Reproduces and verifies the fix for the HTML tag rendering bug.

**Bug Description**:
After clicking "Enable Learning Mode", HTML tags were being displayed as plain text in the webpage instead of being properly rendered. Users would see:

```
<u class="enx-word enx-good" data-word="Good" ...>Goodu>
```

instead of seeing the word "Good" with an underline.

**Test Coverage**:

1. **Basic HTML tag generation** - Verifies that `<u>` tags are properly formed with matching opening/closing tags
2. **HTML escaping prevention** - Ensures HTML tags are not escaped to `&lt;u&gt;` format
3. **innerHTML round-trip** - Validates that setting and reading `innerHTML` works correctly
4. **textContent to HTML conversion** - Tests the core flow of converting text nodes to HTML with highlights
5. **Multiple word replacements** - Ensures proper tag structure when highlighting multiple words
6. **Bug reproduction** - Specifically tests that the reported bug pattern doesn't occur

**How to Run**:

```bash
# Run only this test file
pnpm test htmlRendering.test.ts

# Run with coverage
pnpm test htmlRendering.test.ts --coverage

# Run in watch mode
pnpm test htmlRendering.test.ts --watch
```

**Test Results**:

```
✓ should properly render HTML tags without escaping
✓ should not escape < and > characters in generated HTML
✓ should handle textContent -> HTML replacement correctly
✓ should maintain proper tag structure with multiple replacements
✓ should reproduce the exact bug scenario from user report
```

### `wordHighlighting.test.ts`

Tests for word highlighting logic including:

- Word extraction from text
- Color code generation based on word frequency
- HTML highlighting with word data
- Performance optimizations

### `highlightingIntegration.test.ts`

Integration tests for the complete word highlighting flow:

- Full sentence processing
- Multiple word types (known, unknown, acquainted)
- Integration with word data structures

## Running All Tests

```bash
# Run all content script tests
pnpm test src/content

# Run all tests in the project
pnpm test

# Run with coverage report
pnpm test --coverage

# Run in watch mode for development
pnpm test --watch
```

## Test Infrastructure

- **Test Framework**: Jest
- **Test Environment**: jsdom (simulates browser DOM)
- **TypeScript**: Full TypeScript support via ts-jest
- **Mock Chrome APIs**: Chrome extension APIs are mocked in `src/test/setup.ts`

## Writing New Tests

When adding new tests:

1. Create test files with `.test.ts` or `.test.tsx` extension
2. Use descriptive test names that explain what is being tested
3. Group related tests using `describe()` blocks
4. Add comments explaining complex test scenarios
5. Verify tests pass before committing: `pnpm test`

## Debugging Tests

```bash
# Run tests in verbose mode
pnpm test --verbose

# Run a specific test by name
pnpm test -t "should properly render HTML"

# Generate coverage report
pnpm test --coverage
```

## Related Documentation

- [Jest Documentation](https://jestjs.io/)
- [Testing Library](https://testing-library.com/)
- [Chrome Extension Testing Guide](https://developer.chrome.com/docs/extensions/mv3/tut_testing/)
