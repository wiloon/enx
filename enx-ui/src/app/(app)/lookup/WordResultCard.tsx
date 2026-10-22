import { Volume2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import LookupCount from '@/components/app/LookupCount'
import { Button } from '@/components/ui/button'
import { formatPhonetic } from '@/lib/phonetic'
import { playPronunciation } from '@/lib/pronunciation'
import { WordData } from '@/types'

interface WordResultCardProps {
  data: WordData
  // Admin-only: omit it and the Clear button is not rendered.
  onClear?: () => void
  clearing?: boolean
  // Admin-only: the lookup source to show beside the id (ADR-040).
  source?: string | null
}

export default function WordResultCard({
  data,
  onClear,
  clearing = false,
  source,
}: WordResultCardProps) {
  const phonetic = formatPhonetic(data.Pronunciation)

  return (
    <Card className="gap-0 py-0">
      <div className="flex items-start justify-between gap-4 px-6 pt-6">
        <div className="min-w-0 space-y-1">
          <h2 className="text-3xl font-semibold tracking-tight break-words">
            {data.English}
          </h2>
          <div className="flex items-center gap-1 text-muted-foreground">
            {phonetic && <span>{phonetic}</span>}
            {/* Same icon and hint as the extension's word popover. */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => playPronunciation(data.English)}
              aria-label="Play pronunciation"
              title="Play pronunciation"
              className="size-8 text-muted-foreground hover:text-brand"
            >
              <Volume2 aria-hidden="true" />
            </Button>
          </div>
        </div>
        {onClear && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={clearing}
            className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            {clearing ? 'Clearing...' : 'Clear'}
          </Button>
        )}
      </div>

      {data.Chinese && (
        <p className="px-6 pt-4 pb-6 text-lg leading-relaxed whitespace-pre-line">
          {data.Chinese}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-6 py-3 text-xs text-muted-foreground">
        <LookupCount count={data.LoadCount} />
        <span className="ml-auto flex min-w-0 items-center gap-3">
          {source && (
            <span title="Lookup source" className="text-muted-foreground">
              {source}
            </span>
          )}
          <span className="truncate font-mono">ID {data.Id}</span>
        </span>
      </div>
    </Card>
  )
}
