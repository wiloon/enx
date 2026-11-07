import { useAuth } from '@clerk/chrome-extension'
import CatglishLogo from '@/components/CatglishLogo'
import { config } from '@/config/env'
import { environmentTag } from '@/lib/buildInfo'
import {
  ArrowTopRightOnSquareIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline'

/**
 * The popup's top bar. The logo and product name together are one link: to
 * the app home (/app) for a signed-in user, who has already installed the
 * extension and gains nothing from the marketing page, and to the main site
 * otherwise, including while Clerk is still loading. A plain new-tab link
 * (Chrome closes the popup as the tab takes focus, which is fine since the
 * user is leaving it). The
 * hover background and the trailing arrow are there because a logo in a
 * popup otherwise reads as decoration.
 */
export default function PopupHeader() {
  const { isLoaded, isSignedIn } = useAuth()
  const href =
    isLoaded && isSignedIn
      ? `${config.frontendBaseUrl}/app`
      : config.frontendBaseUrl
  const tag = environmentTag(config.environment, config.apiBaseUrl)

  const openOptions = () => {
    chrome.runtime.openOptionsPage()
  }

  return (
    <header className="flex items-center gap-2 border-b border-border bg-background py-1.5 pl-2 pr-4">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title="Open Catglish"
        aria-label={tag ? `Open Catglish (${tag.text} build)` : 'Open Catglish'}
        className="group flex flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-muted"
      >
        <CatglishLogo className="h-8 w-8 shrink-0" />
        <div className="flex-1 leading-tight">
          <p className="flex items-center gap-1 whitespace-nowrap text-sm font-semibold text-foreground">
            Catglish
            <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 text-muted-foreground transition group-hover:text-foreground" />
            {tag && (
              <span
                title={tag.title}
                className="ml-0.5 shrink-0 rounded-full border border-warning bg-warning-muted px-1.5 text-[10px] font-semibold uppercase leading-4 text-warning-foreground"
              >
                {tag.text}
              </span>
            )}
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
