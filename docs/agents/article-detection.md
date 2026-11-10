# Article detection: current behaviour

How enx-chrome decides where learning mode runs on a web page, as the code on `main` does it today. The planned layers and their order are [ADR-072](../architecture/adr-072-article-detection-layers-and-roadmap.md); this doc covers only what is built. This is a **current-state doc**: it says what the code does, not why or how it got here. The reasons and the history are in [ADR-034](../architecture/adr-034-site-support-on-demand-injection-and-generic-content-detection.md) and its amendments. The code is the final authority: `createPageArticleChoice()` in `enx-chrome/src/content/articleChoice.ts`, `resolveLookupArea()` in `enx-chrome/src/lib/lookupArea.ts` (layer 6) over `WordProcessor.findLookupArea()` in `enx-chrome/src/lib/wordProcessor.ts` (steps 3–5 and the whole page), the adapters in `enx-chrome/src/lib/siteAdapters.ts` and the platform rules in `enx-chrome/src/lib/platformSelectors.ts`, pinned by `enx-chrome/src/content/__tests__/getArticleNode.test.ts`, `enx-chrome/src/lib/__tests__/lookupArea.test.ts` and `enx-chrome/src/lib/__tests__/siteAdapters.test.ts`.

A PR that changes any rule below updates this doc in the same PR.

## 1. Injection: when the content script is on the page

| Path | Sites | Code |
| --- | --- | --- |
| Persistent (`content_scripts[0].matches`) | RSSX (ADR-033) and enx-ui (ADR-019 Reader) only | `src/config/manifest.ts` |
| On demand: the popup's enable button injects through `activeTab` + `chrome.scripting.executeScript`, then retries `enxRun` with backoff | any `http(s)` page | `src/lib/enableLearningMode.ts` |
| "Always enable on this site": a dynamically registered content script that turns learning mode on at page load | sites the user opted into (ADR-039) | `src/lib/autoEnableSite.ts` |

X has no persistent injection (2026-10-15 amendment). The second, wildcard `web_accessible_resources` entry in `manifest.ts` lets the on-demand loader import the real bundle on any site.

## 2. User choice (ADR-073, #715)

The popup's **Choose article** is available while learning mode is on or off on supported HTTP(S) pages, except the X, enx-ui Reader and RSSX adapters. Starting the picker turns learning mode off and ends its reading session. The pointer outlines an element and shows its trimmed text length; ↑ expands to its parent, ↓ returns along that path, click confirms, and Esc restores the previous area and on/off state. The picker intercepts clicks and arrow keys so they neither look up words nor activate or scroll the page. `<html>`, `<body>` and extension UI are ineligible.

A confirmed node is the article before every automatic layer, including dedicated selectors on eligible adapters. Confirmation re-enables through the existing learning-mode flow, including language checks and error reporting. Click lookup, highlights and reading statistics use the new area. Picker rules and learning-mode transitions live in `src/lib/articleChoice.ts`; DOM selection and rendering are in `src/content/articlePicker.ts`, with local storage wired by `src/content/articleChoice.ts`.

The extension saves one uniquely matching selector per hostname under `articleChoice:<hostname>` in `chrome.storage.local`. Generation tries an id first, stable classes next, then tag structure and ancestor chains (which may anchor to `body` without selecting it); it uses no positional selectors and skips build-hash-looking classes. It validates that the selector matches exactly the selected node. If no reliable selector exists, the node still works on this page, the previous hostname rule is deleted, and the page and popup explain **This page only**. Reload and other pages then use automatic detection. Nothing is uploaded.

On a later page, a saved selector must match exactly one eligible node. Zero matches, multiple matches or an invalid selector fall through to automatic detection and the popup explains the fallback; the saved rule remains. The popup shows **Automatic detection** or **Your choice**, including the page-only qualifier. **Use automatic** clears the page-only node and saved rule, immediately recalculates the area, and preserves the learning-mode on/off state. Esc changes neither the previous choice nor storage. Account/session loss or an explicit stop abandons the picker without resuming learning mode.

## 3. Site adapter

`resolveSiteAdapter()` picks one adapter per page. An adapter with a `contentSelector` (X, Reader, RSSX, Wikipedia, Standard Ebooks, AWS docs) uses only that selector: its matches longer than its `minTextLength` are the article, and matches nested inside another match are dropped. When nothing matches, the article is empty (`no-article-node`) and no fallback runs, unless the adapter sets `wholePageOnMiss`: then the page gets step 7's whole page. Platform selectors, built-in selectors and layer 6 never run for these adapters. Every other page gets the `default` adapter and steps 4–7.

An adapter with a `readySelector` makes the initial run (the popup's enable and "Always enable" alike) wait before detection: until the selector matches with non-empty text and the page then stays quiet for 100 ms, or 8 s pass. A temporary `MutationObserver` watches for it and is released when the wait ends, or at once when the run is superseded (learning mode turned off or re-run, the script standing down, an SPA navigation); a superseded run detects nothing. After a timeout, detection runs as usual, so a page without the selector gets its normal miss. This holds for `static` and `spa` adapters alike; only `spa` adapters also re-run on in-page navigation (`src/content/initialRun.ts`, `src/content/spaRebuild.ts`).

| Adapter | Pages | `contentSelector` | `readySelector` (initial wait) | On a miss |
| --- | --- | --- | --- | --- |
| `x` | X tweet detail pages | tweet text, X Article body | the tweet text or Article body in the opened tweet | `no-article-node` |
| `reader` | enx-ui `/reader`, `/welcome` | `#enx-reader-article` | none | `no-article-node` |
| `rssx` | the RSSX Reader | `article` | `article` | `no-article-node` |
| `wikipedia` | `*.wikipedia.org` | `#mw-content-text .mw-parser-output` | none | `no-article-node` |
| `standard-ebooks` | `standardebooks.org/ebooks/…/text/…` | an element whose EPUB type has the token `bodymatter` or one of the prose front and back matter types `introduction`, `preface`, `foreword`, `prologue`, `epilogue`, `afterword`, `epigraph`, `dedication`, `endnotes`: `[*\|type~="…"]` for the real XHTML pages, `[epub\:type~="…"]` for a literal HTML attribute (and jsdom). Boilerplate (`titlepage`, `halftitlepage`, `imprint`, `toc`, `colophon`, `copyright-page`) and any other type stay out | none | whole page (`wholePageOnMiss`): boilerplate pages like `/text/imprint` and `/text/colophon` |
| `aws-docs` | `docs.aws.amazon.com` | the docs content column `#main-col-body`, rendered by script after load | `#main-col-body` | whole page (`wholePageOnMiss`) after the 8 s wait: landing and index pages |

## 4. Platform selectors (default adapter)

Many sites come from one CMS or doc generator that puts the article in a fixed class (ADR-072 decision 2). A **platform rule** is a **platform signal**, which says the page comes from that platform, plus one or more ordered **platform selectors**. A rule runs only when its signal is on the page; rules are tried in `PLATFORM_RULES` order. Each selector follows the broad-selector rule below: a match needs more than the adapter's `minTextLength` (100 by default) characters, nested matches are dropped, and only the longest is kept. When none of a rule's selectors qualifies, the next rule runs, then step 5. The winning rule's name is `LookupArea.platform` (unset for any other match).

A signal is either a `meta[name="generator"]` whose content contains the rule's generator string (case-insensitive substring), or an element only that platform puts on its pages.

| Platform | Signal | Selectors |
| --- | --- | --- |
| `wordpress` | generator `wordpress`, or the REST API link `link[rel="https://api.w.org/"]` | `.entry-content`, then `.hentry .entry` (classic themes) |
| `ghost` | generator `ghost` | `.gh-content` |
| `substack` | `link[href^="https://substackcdn.com/"]` | `.available-content` |
| `blogger` | generator `blogger` | `.post-body` |
| `sphinx` | a `documentation_options.js` or `sphinx_highlight.js` script | `div.body`, then `[role="main"]` |
| `docusaurus` | generator `docusaurus` | `.theme-doc-markdown` |

`.entry-content` and `.post-body` also stay in the built-in list, for sites that use the class without the signal.

## 5. Built-in selectors (default adapter)

An automatically detected **article** comes from a selector (the adapter's `contentSelector`, a platform selector, or this list) or from step 6. This list is tried in order; the first selector with a match wins, and matches nested inside another match are dropped.

- **Precise selectors**: the site-specific ones (BBC, InfoQ, NYT, Ars Technica's article blocks `.post-content-double`, …) and `article`. A match counts when its trimmed text is longer than 1 character; all matches are returned.
- **Broad selectors**: `.post-content`, `.content`, `.entry-content`, `.post-body`. A match needs more than 100 characters; only the longest is kept.

The list itself is `WordProcessor.BUILT_IN_SELECTORS`. A site whose article no selector finds gets click lookup back through a new selector or a site adapter ([adding-website-support.md](adding-website-support.md)). Which sites to cover, and how a selector change is measured before it lands, is [ADR-070](../architecture/adr-070-article-detection-site-corpus-and-evaluation.md).

## 6. JSON-LD-gated Readability (default adapter, ADR-077)

When steps 3–5 find nothing on the default adapter, `resolveLookupArea()` tries once more before the whole page:

1. **Gate:** a `script[type="application/ld+json"]` holds an entity whose `@type` (a string or an array) ends in `Article`, or is `BlogPosting`, `LiveBlogPosting` or `APIReference`. Entities are read at the top level, in arrays, and under `@graph`, `mainEntity` and `mainEntityOfPage`; other keys (e.g. a listing's `hasPart`) are not followed. Malformed JSON-LD is skipped. No match: whole page, and Readability is not loaded.
2. **Node:** Readability runs on a clone of the document whose elements carry their page index; the lowest common ancestor of the page elements in its output is the node. No output, or the node is `body` or `html`: whole page.
3. **Node conditions:** without `script`, `style` and `noscript`, whitespace collapsed, the node has at least 500 characters and link density (text of outermost links / all text) at most 0.2. Otherwise whole page.

A node that passes is the article, with source `article` and `fallback: 'json-ld-readability'` on the `LookupArea`. Readability is its own chunk, loaded by dynamic `import()` from `src/content/loadReadability.ts` only once the gate passes; it is never in the always-loaded content script. If the chunk fails to load, learning mode opens on the whole page. A user choice (step 2) still wins. The shared article choice report sends a layer 6 result as `autoSource: 'article'` with no selector.

## 7. Whole page

When neither a selector nor step 6 finds an article (on the default adapter, or an adapter with `wholePageOnMiss`), learning mode still turns on, with `<body>` as the lookup area and source `whole-page`. A whole page with no lookup-eligible text fails with `no-words`.

## Article vs whole page

`lookupAreaFeatures()` in `wordProcessor.ts` decides this table.

| | Article (steps 2–6) | Whole page (step 7) |
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

## Measuring

`task article-eval` (in `enx-chrome/`, ADR-070) opens every page in `article-eval/corpus.json` in Playwright's Chromium and prints how well the lookup area matches the article. It needs the live sites, so it never runs in CI.

- **Chosen area:** evaluation measures automatic detection, independent of locally saved user choices. The page runs `resolveSiteAdapter()` (with no build-target sites) and `resolveLookupArea(lookupAreaOptions(adapter))` with Readability bundled in, from `src/articleEval/pageProbe.ts`. The `SOURCE` column reads `article (layer 6)` when step 6 found the article.
- **Reference:** Mozilla Readability's article, parsed from a clone of the same document.
- **Scores:** both texts lose `script`, `style` and `noscript`, keep links and code, and are compared as sets of lower-cased 5-word shingles. **Coverage** is the share of the reference inside the chosen area, **precision** the share of the chosen area that is reference.
- **Verdicts**, first match wins: `load failed`; `no article node` (empty area); `whole page` (coverage 0); `no reference` (Readability found none); `misses text` (coverage < 0.8); `too broad` (precision < 0.7); `ok`. A score that can't be computed prints `n/a`.
- **Platform:** the report's `PLATFORM` column and each baseline entry's `platform` name the platform rule that found the article; `-` in the report and `null` in the baseline for any other result. Baseline entries recorded without the field still compare.
- **Baseline:** a run lists the pages whose verdict changed or whose score moved more than 0.05 against `article-eval/baseline.json`. `task article-eval -- --update-baseline` rewrites it in corpus order: pages no longer in the corpus drop out, pages a `--only` run didn't measure keep their entry, and a page that now fails to load keeps its last entry that loaded. `-- --only <url part>` runs the matching pages only; `-- --headed` shows the browser.
- **Unmeasured:** every page that failed to load in this run is listed under "Unmeasured" after the summary, whatever the baseline holds for it.

The scoring and the report are `src/lib/articleEval/`; the browser side is `article-eval/`, pinned by `e2e/article-eval.spec.ts`.

### Labelled offline datasets

Run `task article-eval -- --dataset zyte` in `enx-chrome/` to score both the extension and Mozilla Readability against human-labelled `articleBody` text. Each page has coverage, precision and verdict columns for both extractors, followed by separate summaries. The existing 5-word shingles and verdict thresholds apply. Summary means include only pages with both scores available, and state the scored count; whole-page results retain coverage 0 and precision `n/a` as in online mode. The online baseline is not read or updated (`--update-baseline` is rejected with `--dataset`). `--only <url part>` and `--headed` also work.

- **Dataset:** [Zyte article-extraction-benchmark](https://github.com/scrapinghub/article-extraction-benchmark/tree/4a3bc979f76c0df73cb95fe272e2fc1b96f9f010), 181 pages, pinned to commit `4a3bc979f76c0df73cb95fe272e2fc1b96f9f010`. Its [licence is MIT](https://github.com/scrapinghub/article-extraction-benchmark/blob/4a3bc979f76c0df73cb95fe272e2fc1b96f9f010/LICENSE). Page contents remain the original publishers' copyright and are used only locally for measurement.
- **Cache:** at run time the loader downloads `ground-truth.json` and `html/<id>.html.gz` from the pinned commit into `~/.cache/enx/article-eval/zyte/<commit>/`. Later runs reuse those files without downloading again. Downloads are validated before atomic cache writes; an interrupted download is retried next time. No dataset labels or snapshots are committed.
- **Browser:** every snapshot gets a fresh context with service workers blocked. `page.route` serves the HTML only for the initial main-frame navigation at its labelled URL and aborts every other request, including CSS, external scripts, images, fonts and frames. A response CSP disables page scripts so they cannot mutate the snapshot. The same bundled page probe as online mode runs via DevTools evaluation. No requests reach the original sites. A failed page is unmeasured for both extractors.
- **Loader boundary:** `DatasetLoader.load()` returns `{ id, url, html, labelText, pageType? }[]` (`src/lib/articleEval/dataset.ts`). Another dataset needs a loader and a registration in `article-eval/options.ts`, which also prints its header (dataset, pinned commit, label source); scoring and reporting remain shared. Loaders download through `cachedDownloader` (`article-eval/cache.ts`), given the source base URL, cache directory and a validator.
- **Excluded:** WCEB was rejected because its README provides no clear commercial licence for the data, and several constituent corpora are research-only or unlicensed.
- **Checks:** hand-written snapshots in `e2e/test-fixtures/article-eval-labelled*.html` exercise offline routing and scores in `e2e/article-eval.spec.ts`. Downloading and measuring a full dataset is a local manual check, never CI.

#### WCXB

Run `task article-eval -- --dataset wcxb` to score both extractors against WCXB's `ground_truth.main_content` on article and documentation pages.

- **Dataset:** WCXB, the web content extraction benchmark by Murrough Foley: [the repository at the pinned commit](https://github.com/Murrough-Foley/web-content-extraction-benchmark/tree/c039d5ee9f5a3a984a0e167e63aacd04e76e78a9), pages from 2025 (`metadata.json` at that commit lists 1,869), under its [CC-BY-4.0 licence at that commit](https://github.com/Murrough-Foley/web-content-extraction-benchmark/blob/c039d5ee9f5a3a984a0e167e63aacd04e76e78a9/LICENSE). `--dataset wcxb` scores only `article` and `documentation` pages: the other types aren't articles and would skew the scores. Both `dev/` and `test/` splits are used, since nothing is trained.
- **Non-article pages:** `--dataset wcxb-negative` opens the `listing`, `collection`, `product`, `service` and `forum` pages instead and scores nothing. It reports, per page type and in total, how many pages were measured and unmeasured, and how many got a selector node, a layer 6 node or the whole page, then lists every layer 6 page so a false positive can be checked by hand (ADR-077's negative set). Labels are not needed, so an empty label is still measured; a page with no URL or that fails to load is unmeasured with its reason. Forum pages may be one long post: read their count on its own.
- **Label caveat:** the labels were drafted by an LLM (Claude) and then reviewed by people, and the dataset is a 2026 single-author project. When a page scores low, check its label before trusting the score.
- **Cache:** the loader downloads `metadata.json` from commit `c039d5ee9f5a3a984a0e167e63aacd04e76e78a9` into `~/.cache/enx/article-eval/wcxb/<commit>/`, then `<split>/ground-truth/<id>.json` and `<split>/html/<id>.html.gz` for the selected pages only. Files of other page types are never downloaded. JSON and gzip contents are validated before the atomic cache write, as for Zyte.
- **Loader:** `metadata.json`'s `files` object is the index: each key is the page ID (unique across splits, digits only) with its `split` and `page_type`. Each page's label is `ground_truth.main_content`, its URL `url` and its type `_internal.page_type.primary`. An invalid ID, split, non-string label (other than null or missing), missing page type, or a page type that disagrees with the index fails the load with the file or ID named. A missing or invalid URL is unmeasured; null or missing labels are treated as empty.
- **Report:** a `PAGE TYPE` column, and after the overall summaries an Ours and a Readability summary per page type. When step 6 found any article, a `Layer 6:` line counts those pages and their `ok`, `misses text` and `too broad` verdicts (Zyte too). Every report (the online corpus as well) ends with a `Layer 6 ran on N pages: p50 / p90 / max` line when any page passed step 6's gate, timed from the gate to the decision, whether or not the node was kept. A label with no text after trimming is unmeasured: the page is not opened in the browser, adds nothing to the means, and is listed under "Unmeasured" with its ID, URL, page type and the reason. Zyte rows carry no page type, so the Zyte report has neither.
- **Checks:** fake downloads in `scripts/__tests__/article-eval-wcxb.test.mjs` cover the WCXB loader and its cache; no dataset pages are committed.

### The corpus

Each `article-eval/corpus.json` entry is `{ "url", "category", "provenance", "trancoRank" }`, plus `"handWritten": true` on a hand-written page (ADR-075). `src/lib/articleEval/__tests__/corpus.test.ts` checks the committed file with `corpusProblems` (`src/lib/articleEval/corpus.ts`):

- **Sites:** a site is a hostname, and every site has exactly two distinct pages. All of a site's pages share its `provenance` and `trancoRank`.
- **`category`:** `news`, `tech-media`, `blog-platform`, `docs`, `personal` or `reference`, assigned by the operator.
- **`provenance`:** why the site is in the corpus, whatever found its URLs. `hand-picked`: chosen by hand, which covers the sites the corpus had before ADR-075 and a site added while adding website support. `recommended`: an English article site a model recommended and checked against the Tranco rank (ADR-075). It is not the report's `source` column.
- **`trancoRank`:** the rank of the site's registrable domain in the Tranco list below, so subdomains share their parent's rank (`spectrum.ieee.org` has the rank of `ieee.org`); `null` when the domain isn't listed.
- **`handWritten`:** `true` marks a page added after ADR-075 without discovery, because discovery found no usable page and the operator picked it from the site's own navigation ([§Finding article pages](#finding-article-pages)). Only `hand-picked` sites may have one, and `true` is the only value. Pages carried over from before ADR-075, including the ones #733 restored, stay unmarked even though no script found them.
- **Ranks come from Tranco list [94P72](https://tranco-list.eu/list/94P72)**: the daily list of 2026-11-07 (top 1M pay-level domains, Dowdall combination of CrUX, Farsight, Majestic, Cloudflare Radar and Umbrella over 2026-10-09 to 2026-11-07). The list is free to download for research and has no terms of its own; its providers' data is licensed as the Tranco home page states (Majestic CC BY 3.0, CrUX CC BY-SA 4.0, Cloudflare Radar CC BY-NC 4.0, Umbrella free of charge), with attribution. The repository stores only the selected domains' ranks, never the list: download it outside the repo to look up a new site's rank.
- **Ranks are a sanity check, not a filter:** sites are chosen as English article sites people read a lot, and the rank only confirms their size. Neither the report nor the baseline sorts by rank.

### Finding article pages

Corpus pages come from `task article-eval-discover -- <site homepage URL>` (in `enx-chrome/`, ADR-075); a hand-picked site falls back to a hand-written page only when discovery fails. It prints JSON:

```json
{
  "site": "https://www.theguardian.com/",
  "candidates": [{ "url": "https://www.theguardian.com/…", "date": "2026-11-08T13:00:41.000Z", "source": "https://www.theguardian.com/us/rss" }],
  "failures": [{ "url": "https://apnews.com/", "error": "HTTP 403" }]
}
```

- **Sources, in order:** the homepage's RSS/Atom `<link rel="alternate">` feeds, the `Sitemap:` entries in `/robots.txt`, then `/feed`, `/rss`, `/feed.xml`, `/rss.xml`, `/atom.xml`, `/index.xml`, `/sitemap.xml`, `/sitemap_index.xml`. A later source is tried only while fewer than two articles are found. Sitemap indexes are followed (newest five children, two levels deep) and gzipped sitemaps are unpacked.
- **A homepage with a path** (docs served under a path, such as `https://docs.astral.sh/uv/`): pass that path as the homepage. The common feed and sitemap paths are then tried under it (`/uv/feed`, …, `/uv/sitemap_index.xml`) before the root ones. The path comes from the homepage's final URL after redirects (the input URL when the homepage fails to load), read as a directory. For a blog-platform author, pass the author's page (`https://medium.com/@name`) so its feed link is used.
- **Selection:** newest first by feed publication date or sitemap `lastmod`; undated pages follow in source order. The homepage (the input URL and its final URL, ignoring a trailing slash or fragment), other sites, files, and listing or site pages (`tag`, `category`, `author`, `page`, `about`, …) are skipped, and each URL counts once. Other paths on the same hostname stay eligible. A candidate is kept only when its final response, after redirects, is 2xx, still an article URL and not the homepage; `url` is that final URL.
- **Bounds and failures:** each request times out after 15 seconds and a run makes at most 40 requests. Every source or candidate that failed is printed to stderr and listed in `failures`; the command exits 1 when it found fewer than two articles.
- **Then:** add the two candidates to `article-eval/corpus.json` with the site's category, provenance and Tranco rank ([§The corpus](#the-corpus)), and screen them with `task article-eval` like every other page. A candidate can still be a landing page a feed or sitemap lists (for example a project hub). To replace a page that fails screening, or to pass over video, landing or other non-article pages, rerun with `-- <site homepage URL> --skip <bad page URL>` (repeatable) and take the next candidate.
- **When discovery finds no usable page:** drop a `recommended` site. For a `hand-picked` site, pick an article from the site's own navigation and give its entry `"handWritten": true` ([§The corpus](#the-corpus)); when the site has no second article at all, drop it.

`src/lib/articleEval/discovery.ts` holds the parsing and selection; `article-eval/discover.ts` supplies the network.
