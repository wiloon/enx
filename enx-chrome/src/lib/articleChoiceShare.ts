// ADR-073 decision 5 (amended by ADR-076): a confirmed article choice the
// user agreed to share, as the article_choice feedback record enx-api takes.
// It carries the cleaned page address, the chosen selector and what
// automatic detection finds at confirmation -- never page text or title.
import { sanitizePageUrl } from './pageReport'
import type { LookupArea } from './wordProcessor'

export interface ArticleChoiceReport {
  url: string
  adapter: string
  selector: string
  autoSource: 'article' | 'whole-page' | 'none'
  autoSelector?: string
  autoPlatform?: string
}

/**
 * The report for a confirmed choice, or null when there is nothing to send:
 * a page-only choice has no selector and cannot become a rule, and a page
 * whose address cannot be cleaned is not reported.
 */
export function articleChoiceReport(input: {
  url: string
  adapter: string
  selector: string | null
  detected: LookupArea
}): ArticleChoiceReport | null {
  const url = sanitizePageUrl(input.url)
  if (input.selector === null || url === null) return null
  const report = { url, adapter: input.adapter, selector: input.selector }
  const { nodes, source, selector, platform } = input.detected
  if (nodes.length === 0) return { ...report, autoSource: 'none' }
  if (source === 'whole-page') return { ...report, autoSource: 'whole-page' }
  return {
    ...report,
    autoSource: 'article',
    ...(selector && { autoSelector: selector }),
    ...(selector && platform && { autoPlatform: platform }),
  }
}
