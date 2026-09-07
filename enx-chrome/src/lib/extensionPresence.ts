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
