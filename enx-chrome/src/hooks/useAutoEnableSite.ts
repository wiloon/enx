import { useEffect, useState } from 'react'
import {
  autoEnableSiteFor,
  type AutoEnableManifest,
} from '@/lib/autoEnableSite'

// adr-039: the popup's "Always enable on this site" toggle. Its state is the
// optional host permission itself -- turning it on asks Chrome for the exact
// origin, turning it off gives the permission back. The background's
// permissions.onAdded/onRemoved listeners do the script registration, so
// nothing here depends on the popup surviving Chrome's permission dialog.
export function useAutoEnableSite() {
  const [site, setSite] = useState<string | null>(null)
  const [enabled, setEnabledState] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })
      const candidate = autoEnableSiteFor(
        tab?.url,
        chrome.runtime.getManifest() as AutoEnableManifest
      )
      if (cancelled) return
      setSite(candidate)
      if (!candidate) return
      const granted = await chrome.permissions.contains({
        origins: [candidate],
      })
      if (!cancelled) setEnabledState(granted)
    })().catch(error => console.error('auto-enable site lookup failed:', error))
    return () => {
      cancelled = true
    }
  }, [])

  // Called straight from the click handler with no await before
  // permissions.request(): Chrome only shows the dialog inside a user gesture.
  const setEnabled = async (value: boolean) => {
    if (!site) return
    try {
      if (value) {
        setEnabledState(await chrome.permissions.request({ origins: [site] }))
      } else {
        await chrome.permissions.remove({ origins: [site] })
        setEnabledState(false)
      }
    } catch (error) {
      console.error('auto-enable permission change failed:', error)
    }
  }

  const host = site ? new URL(site.slice(0, -1)).host : null

  return { site, host, enabled, setEnabled }
}
