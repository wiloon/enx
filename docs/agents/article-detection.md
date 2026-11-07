# Article detection: current behaviour

How enx-chrome decides where learning mode runs on a web page, as the code on `main` does it today. This is a **current-state doc**: it says what the code does, not why or how it got here. The reasons and the history are in [ADR-034](../architecture/adr-034-site-support-on-demand-injection-and-generic-content-detection.md) and its amendments. The code is the final authority: `WordProcessor.findLookupArea()` in `enx-chrome/src/lib/wordProcessor.ts` and the adapters in `enx-chrome/src/lib/siteAdapters.ts`, pinned by `enx-chrome/src/content/__tests__/getArticleNode.test.ts` and `enx-chrome/src/lib/__tests__/siteAdapters.test.ts`.

A PR that changes any rule below updates this doc in the same PR.

## 1. Injection: when the content script is on the page

| Path | Sites | Code |
| --- | --- | --- |
| Persistent (`content_scripts[0].matches`) | RSSX (ADR-033) and enx-ui (ADR-019 Reader) only | `src/config/manifest.ts` |
| On demand: the popup's enable button injects through `activeTab` + `chrome.scripting.executeScript`, then retries `enxRun` with backoff | any `http(s)` page | `src/lib/enableLearningMode.ts` |
| "Always enable on this site": a dynamically registered content script that turns learning mode on at page load | sites the user opted into (ADR-039) | `src/lib/autoEnableSite.ts` |

X has no persistent injection (2026-10-15 amendment). The second, wildcard `web_accessible_resources` entry in `manifest.ts` lets the on-demand loader import the real bundle on any site.

## 2. Site adapter

`resolveSiteAdapter()` picks one adapter per page. An adapter with a `contentSelector` (X, Reader, RSSX, Wikipedia, Standard Ebooks) uses only that selector: its matches longer than its `minTextLength` are the article, and matches nested inside another match are dropped. When nothing matches, the article is empty (`no-article-node`) and no fallback runs, unless the adapter sets `wholePageOnMiss`: then the page gets step 4's whole page. Every other page gets the `default` adapter and steps 3–4.

| Adapter | Pages | `contentSelector` | On a miss |
| --- | --- | --- | --- |
| `x` | X tweet detail pages | tweet text, X Article body | `no-article-node` |
| `reader` | enx-ui `/reader`, `/welcome` | `#enx-reader-article` | `no-article-node` |
| `rssx` | the RSSX Reader | `article` | `no-article-node` |
| `wikipedia` | `*.wikipedia.org` | `#mw-content-text .mw-parser-output` | `no-article-node` |
| `standard-ebooks` | `standardebooks.org/ebooks/…/text/…` | the EPUB `bodymatter` type: `[*\|type~="bodymatter"]` for the real XHTML pages, `[epub\:type~="bodymatter"]` for a literal HTML attribute (and jsdom) | whole page (`wholePageOnMiss`): front and back matter pages like `/text/imprint` |

## 3. Built-in selectors (default adapter)

The **article** comes only from a selector: the adapter's `contentSelector`, or this list. Tried in list order; the first selector with a match wins, and matches nested inside another match are dropped.

- **Precise selectors**: the site-specific ones (BBC, InfoQ, NYT, …) and `article`. A match counts when its trimmed text is longer than 1 character; all matches are returned.
- **Broad selectors**: `.post-content`, `.content`, `.entry-content`, `.post-body`. A match needs more than 100 characters; only the longest is kept.

The list itself is `WordProcessor.BUILT_IN_SELECTORS`. A site whose article no selector finds gets click lookup back through a new selector or a site adapter ([adding-website-support.md](adding-website-support.md)). Which sites to cover, and how a selector change is measured before it lands, is [ADR-070](../architecture/adr-070-article-detection-site-corpus-and-evaluation.md).

## 4. Whole page

When no selector matches (on the default adapter, or an adapter with `wholePageOnMiss`), learning mode still turns on, with `<body>` as the lookup area and source `whole-page`. A whole page with no lookup-eligible text fails with `no-words`.

## Article vs whole page

`lookupAreaFeatures()` in `wordProcessor.ts` decides this table.

| | Article (steps 2–3) | Whole page (step 4) |
| --- | --- | --- |
| Click lookup | yes | no: clicks reach the page's own handlers |
| Word highlighting | yes | no |
| Reading statistics (ADR-028) | counted | not counted; ends the previous reading session |
| Selection lookup (drag, double-click) | whole page | whole page |

## Lookup exclusions

Inside the lookup area, text under these is never looked up or highlighted:

- Tags in `WordProcessor.LOOKUP_EXCLUDED_TAGS`: links, form controls, `code`/`pre`, `summary`, `label`, scripts and styles.
- `WordProcessor.LOOKUP_EXCLUDED_SELECTORS`: X code blocks, `[data-enx-ui]`.
- Default adapter only (`lookupExcludedSelectors`): ARIA interactive roles (`button`, `link`, `tab`, `menuitem`, …) and editable regions. Adapters with a `contentSelector` skip this list: X wraps a quoted tweet in `role="link"`.

## Failure reasons

After the lookup area is chosen, `enxRun` fails with `no-article-node` (empty area), `not-english` (too much Han text, `config.hanCharLimit`), or `no-words`.
