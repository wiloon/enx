import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

interface WordSearchFormProps {
  value: string
  onChange: (value: string) => void
  onSearch: (e: React.FormEvent) => void
}

export default function WordSearchForm({
  value,
  onChange,
  onSearch,
}: WordSearchFormProps) {
  return (
    <form onSubmit={onSearch} className="flex gap-2">
      <Label htmlFor="word-input" className="sr-only">
        Enter English word
      </Label>
      <div className="relative flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id="word-input"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type a word to look up..."
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="h-11 pl-9 text-base"
        />
      </div>
      <Button type="submit" className="h-11 px-5">
        Look Up
      </Button>
    </form>
  )
}
