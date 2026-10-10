import CatglishLogo from '@/components/CatglishLogo'
import { config } from '@/config/env'
import {
  ArrowTopRightOnSquareIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline'

/**
 * The popup's top bar. The logo and product name together are one link to the
 * main site, signed in or not: a plain new-tab link (Chrome closes the popup
 * as the tab takes focus, which is fine since the user is leaving it). The
 * hover background and the trailing arrow are there because a logo in a
 * popup otherwise reads as decoration.
 */
export default function PopupHeader() {
  const openOptions = () => {
    chrome.runtime.openOptionsPage()
  }

  return (
    <header className="flex items-center gap-2 border-b border-border bg-background py-1.5 pl-2 pr-4">
      <a
        href={config.frontendBaseUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Open Catglish"
        aria-label="Open Catglish"
        className="group flex flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-muted"
      >
        <CatglishLogo className="h-8 w-8 shrink-0" />
        <div className="flex-1 leading-tight">
          <p className="flex items-center gap-1 text-sm font-semibold text-foreground">
            Catglish
            <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 text-muted-foreground transition group-hover:text-foreground" />
          </p>
          <p className="text-[11px] text-muted-foreground">
            English Reading Assistant
          </p>
        </div>
      </a>
      <button
        type="button"
        onClick={openOptions}
        title="Settings"
        aria-label="Settings"
        className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <Cog6ToothIcon className="h-[18px] w-[18px]" />
      </button>
    </header>
  )
}
