# Adding New Website Support to ENX

## Document Information

| Field | Value |
|-------|-------|
| **Created** | 2026-01-06 |
| **Last Updated** | 2026-01-06 |
| **Author** | AI Assistant |
| **AI Assisted** | Yes (GitHub Copilot) |
| **AI Model** | Claude Sonnet 4.5 |
| **Status** | Approved |
| **Version** | 1.0.0 |

## Overview

To enable ENX word highlighting on a new website, follow this systematic process. The extension needs to know which websites to monitor and how to identify their article content containers.

## Process Steps

### 1. Add Domain to Manifest

**File:** `enx-chrome/manifest.json`

Add the new website's URL pattern to the `content_scripts.matches` array:

```json
"content_scripts": [
  {
    "matches": [
      "https://www.infoq.com/*",
      "https://messaging-custom-newsletters.nytimes.com/*",
      "https://developers.googleblog.com/*",
      "https://www.microsoft.com/en-us/research/*",
      "https://www.reuters.com/*",
      "https://www.theverge.com/*"  // Add new domain here
    ],
    "js": ["src/content/content.ts"],
    "run_at": "document_end"
  }
]
```

**Important:** Use appropriate URL patterns:
- `https://example.com/*` - All pages under this domain
- `https://example.com/articles/*` - Only pages under /articles/
- `https://*.example.com/*` - All subdomains

### 2. Analyze Target Website

Before adding CSS selectors, inspect the target website to identify the article content container:

**Using Browser DevTools:**
1. Open the target article page (e.g., https://www.theverge.com/tech/855412/nvidia-launches-vera-rubin-ai-computing-platform-at-ces-2026)
2. Right-click on article content → "Inspect"
3. Identify the container element with these characteristics:
   - Contains the main article text
   - Has a reasonable CSS class or ID
   - Has sufficient text length (>100 characters typically indicates real content)
   - Doesn't include navigation, sidebar, or footer content

**Common Patterns:**
- Semantic HTML5: `<article>`, `<main>`
- Class-based: `.article-content`, `.post-body`, `.entry-content`
- ID-based: `#article`, `#main-content`

**Example Inspection:**
```html
<!-- The Verge example -->
<div class="article-content">
  <p>Article text here...</p>
  <p>More content...</p>
</div>
```
→ Selector: `.article-content`

### 3. Add CSS Selector to Content Script

**File:** `enx-chrome/src/content/content.ts`

Add the new selector to the `getArticleNode()` method's selectors array:

```typescript
static getArticleNode(): Element | null {
  const selectors = [
    '.Article',                     // BBC
    '.article__data',              // InfoQ
    '.post-content',               // Generic blog posts
    '.single-post__container',     // Microsoft Research
    '#EMAIL_CONTAINER',            // NY Times newsletters
    '.text',                       // TingRoom
    'article',                     // Semantic HTML5
    '.content',                    // Generic content
    '.entry-content',              // WordPress/blogs
    '.post-body',                  // Generic posts
    '.article-content',            // The Verge (example)
  ]
  
  // ... rest of the method
}
```

**Selector Ordering Strategy:**
- Place more specific selectors before generic ones
- Site-specific selectors first (e.g., `.article__data` for InfoQ)
- Generic selectors last (e.g., `article`, `.content`)
- This ensures the most accurate match is found first

**Why Ordering Matters:**
The method iterates through selectors and returns the first element that:
1. Exists on the page
2. Has text content length > 100 characters

### 4. Test the Integration

After making changes:

1. **Rebuild the extension:**
   ```bash
   cd enx-chrome
   task build
   # or for development with hot reload:
   task dev
   ```

2. **Reload extension in Chrome:**
   - Navigate to `chrome://extensions/`
   - Click "Reload" button on the ENX extension
   - Or use the keyboard shortcut if configured

3. **Test on target website:**
   - Open the target article page
   - Open DevTools Console (F12)
   - Look for ENX log messages:
     ```
     🔍 Searching for article node...
     Current URL: https://www.theverge.com/...
     Trying selector ".article-content": Found
       → Text length: 5432
     ✅ Using article node with selector: .article-content
     ```

4. **Verify word highlighting:**
   - Click the ENX extension icon to toggle ON
   - Words in the article should be highlighted
   - Hovering over words should show definitions

### 5. Handle Edge Cases

**Multiple Selectors Match:**
- The first matching selector with >100 characters is used
- Reorder selectors if a more appropriate one should take precedence

**No Selector Matches:**
- Check DevTools console for "No article node found" message
- Verify the selector is correct using DevTools: `document.querySelector('.your-selector')`
- The page might use dynamic content loading - the selector might need to wait for content

**Dynamic Content:**
If content loads after page load (SPA, lazy loading):
- Consider using MutationObserver (advanced)
- Or add a retry mechanism with delay
- Check if `run_at: "document_idle"` helps in manifest.json

**Site-Specific Issues:**
```typescript
// Example: Handle site-specific cases
static getArticleNode(): Element | null {
  // Special handling for specific domains
  const hostname = window.location.hostname
  
  if (hostname.includes('special-site.com')) {
    // Wait for dynamic content
    const element = document.querySelector('.dynamic-article')
    if (element) return element
  }
  
  // Fall back to standard selectors
  const selectors = [...]
  // ... rest of method
}
```

### 6. Document the Change

After successful integration, document in the appropriate location:

**Option 1: Code Comments**
Add inline comments in `content.ts`:
```typescript
'.article-content',  // The Verge - main article container
```

**Option 2: Changelog/Docs**
Update `enx-chrome/CHANGELOG.md` or create a site support document:
```markdown
## Supported Websites

| Website | Domain | Selector | Notes |
|---------|--------|----------|-------|
| The Verge | theverge.com | `.article-content` | Tech news articles |
```

## Troubleshooting

**Problem:** Extension doesn't activate on new site  
**Solution:** Check that domain is in `manifest.json` matches array and reload extension

**Problem:** "No article node found" in console  
**Solution:** Verify selector with DevTools: `document.querySelector('.your-selector')`

**Problem:** Wrong content is highlighted (navigation, sidebar)  
**Solution:** Use a more specific selector that targets only article content

**Problem:** Only partial content is highlighted  
**Solution:** The selector might be too specific; try a parent container

**Problem:** Console shows "Skipped (text too short: XX < 100)"  
**Solution:** The selected element has insufficient text; find a larger container or adjust the threshold

## Quick Reference Checklist

- [ ] Add URL pattern to `manifest.json` `content_scripts.matches`
- [ ] Inspect target website to identify article container
- [ ] Add CSS selector to `content.ts` `getArticleNode()` method
- [ ] Rebuild extension: `task build` or `task dev`
- [ ] Reload extension in Chrome
- [ ] Test on target website
- [ ] Verify console logs show correct selector
- [ ] Verify word highlighting works
- [ ] Document the change (optional but recommended)

## Currently Supported Websites

| Website | Domain | Selector | Notes |
|---------|--------|----------|-------|
| InfoQ | infoq.com | `.article__data` | Tech news and articles |
| NY Times | nytimes.com | `#EMAIL_CONTAINER` | Newsletter emails |
| Google Developers Blog | developers.googleblog.com | `.post-content` | Blog posts |
| Microsoft Research | microsoft.com/research | `.single-post__container` | Research articles |
| Reuters | reuters.com | `article` | News articles (HTML5 semantic) |
| BBC | bbc.com | `.Article` | News articles |
| Generic blogs | various | `.entry-content`, `.post-body` | WordPress and similar platforms |
