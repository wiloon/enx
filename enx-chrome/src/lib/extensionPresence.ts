import type { LearningModeStatus } from './learningModeStatus'
import { isEnxUiHost, PageLocation } from './siteAdapters'

// ADR-019 Option G2: on enx-ui pages the content script stamps the running
// extension version onto <html data-enx-extension>, so the web app can tell
// "extension installed" synchronously as a fallback to the
// externally_connectable ping.
export function stampExtensionPresence(
  doc: Document,
  location: PageLocation,
  version: string
): void {
  if (!isEnxUiHost(location)) return
  doc.documentElement.dataset.enxExtension = version
}

// ADR-047 Decision 4a: same mechanism, for whether learning mode is on in
// this tab. /welcome reads it to tick "Read with Catglish"; nothing in the
// extension reads it back.
export function stampLearningMode(
  doc: Document,
  location: PageLocation,
  status: LearningModeStatus
): void {
  if (!isEnxUiHost(location)) return
  if (status.status === 'ready') {
    doc.documentElement.dataset.enxLearning = 'on'
  } else {
    delete doc.documentElement.dataset.enxLearning
  }
}
