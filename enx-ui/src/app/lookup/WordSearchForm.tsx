import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

interface WordSearchFormProps {
  value: string
  onChange: (value: string) => void
  onSearch: (e: React.FormEvent) => void
}

export default function WordSearchForm({ value, onChange, onSearch }: WordSearchFormProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onSearch(e)
    }
  }

  return (
    <form onSubmit={onSearch} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="word-input">Enter English word</Label>
        <Input
          id="word-input"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a word to look up..."
          className="text-lg"
        />
      </div>
      <Button type="submit" className="w-full">
        Look Up
      </Button>
    </form>
  )
}
