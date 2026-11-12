import { useEffect, useState } from 'react'
import { describeBuild, type BuildInfo } from '@/lib/buildInfo'

const COPIED_MS = 1500

interface PopupVersionProps {
  inline?: boolean
  build: BuildInfo
  /** Writes text to the clipboard; the popup passes navigator.clipboard's. */
  copy: (text: string) => Promise<void>
}

/**
 * The popup's footer line: the installed version in small print. Hovering
 * shows the full build details; clicking copies them, so a user can paste
 * exactly which build they run into a bug report.
 */
export default function PopupVersion({
  build,
  copy,
  inline = false,
}: PopupVersionProps) {
  const { label, details } = describeBuild(build)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])

  const handleClick = async () => {
    try {
      await copy(details)
      setCopied(true)
    } catch {
      // Nothing to recover: the version stays on screen to read off.
    }
  }

  const button = (
    <button
      type="button"
      onClick={() => void handleClick()}
      title={`${details}\nClick to copy`}
      className="rounded px-1.5 py-0.5 text-xs text-muted-foreground transition hover:bg-background hover:text-foreground active:bg-background/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      {copied ? 'Copied' : label}
    </button>
  )

  return inline ? (
    button
  ) : (
    <footer className="flex justify-center px-3 pb-2">{button}</footer>
  )
}
