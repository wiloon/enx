# Feature: Add Support for Anthropic Skilljar Platform

## Document Information

| Field | Value |
|-------|-------|
| **Created** | 2026-05-02 |
| **Author** | wiloon |
| **Status** | Draft |
| **Type** | Site Support |

## Background

The ENX Chrome extension highlights vocabulary words on supported websites to aid English learning while reading. The extension currently supports sites like InfoQ, Reuters, and Anthropic's main blog.

Anthropic hosts learning courses on the Skilljar LMS platform (e.g., Claude 101 at `https://anthropic.skilljar.com/`). These course pages contain English technical content that is valuable for vocabulary learning.

## Goal

Add ENX word-highlighting support for the Anthropic Skilljar course platform.

**Target URL pattern**: `https://anthropic.skilljar.com/*`  
**Example page**: `https://anthropic.skilljar.com/claude-101/383389`

## Requirements

### Functional

- [ ] ENX word highlighting activates on `https://anthropic.skilljar.com/*` pages
- [ ] Words are highlighted in the lesson content area (not in navigation, sidebar, or UI chrome)
- [ ] Clicking a highlighted word opens the translation popup
- [ ] Highlighting works on both statically and dynamically loaded lesson content

### Non-Functional

- [ ] No regressions on existing supported sites
- [ ] Content selector targets the lesson body specifically to avoid false highlights in menus/headers

## Technical Investigation Required

Before implementation, the following must be verified by inspecting the Skilljar page DOM:

1. **Content container selector** — ✅ Identified: `#lesson-main-content` (outer div) and `.sjwc-lesson-content-item` (inner element). Both added to `getArticleNode()` selectors.

2. **Dynamic content loading** — Out of scope for this iteration. Assumed to be rendered on initial page load.

3. **iframe usage** — Out of scope for this iteration.

## Implementation Plan

1. ~~**Inspect DOM**~~ ✅ — `#lesson-main-content` and `.sjwc-lesson-content-item` identified.
2. ~~**Update `manifest.json`**~~ ✅ — `"https://anthropic.skilljar.com/*"` added to `content_scripts.matches`.
3. ~~**Update `content.ts`**~~ ✅ — Selectors added to `getArticleNode()`.
4. **Handle dynamic content (if needed)** — Verify after manual testing.
5. **Manual test** — Load the extension on the target page and verify highlighting works correctly.
6. **Update `README.md`** — Add Skilljar to the "Supported Websites" list.

## Acceptance Criteria

- Opening `https://anthropic.skilljar.com/claude-101/383389` with ENX enabled shows word highlights in the lesson body
- No highlights appear in navigation bars, headers, or UI buttons
- Clicking a highlighted word shows the translation popup
- Running `task test` passes with no regressions
