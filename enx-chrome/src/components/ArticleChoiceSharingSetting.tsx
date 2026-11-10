import { useEffect, useState } from 'react'
import {
  getArticleChoiceSharing,
  setArticleChoiceSharing,
} from '@/config/preferences'

// ADR-073 decision 5: the same setting the popup asks about before the first
// pick. Unanswered reads as off; toggling here answers the question.
export default function ArticleChoiceSharingSetting() {
  const [enabled, setEnabled] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let alive = true
    getArticleChoiceSharing()
      .then(value => {
        if (alive) setEnabled(value === true)
      })
      .catch(() => {
        if (alive) setError("Couldn't read this setting.")
      })
    return () => {
      alive = false
    }
  }, [])

  const update = async (value: boolean) => {
    setError(undefined)
    setEnabled(value)
    try {
      await setArticleChoiceSharing(value)
    } catch {
      setEnabled(!value)
      setError("Couldn't save this setting. Try again.")
    }
  }

  return (
    <div className="space-y-2">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => void update(e.target.checked)}
          className="mt-1 h-4 w-4 rounded-sm border-border text-brand focus:ring-brand"
        />
        <span>
          <span className="block text-sm font-medium text-foreground">
            Share my article choices
          </span>
          <span className="block text-sm text-muted-foreground">
            When you choose a page&apos;s article yourself, send the cleaned
            page address, the article&apos;s selector, what automatic detection
            found and the extension version, linked to your account, to help
            improve automatic detection. Never the page&apos;s text or title.
            Turning this off stops future sends; choices already sent remain
            until you delete your account.
          </span>
        </span>
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
