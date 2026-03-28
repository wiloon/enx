import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { WordData } from '@/types'

interface WordResultCardProps {
  data: WordData
  onClear: () => void
  clearing: boolean
}

export default function WordResultCard({ data, onClear, clearing }: WordResultCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-2xl">{data.English}</CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={onClear}
          disabled={clearing}
          className="text-red-600 border-red-300 hover:bg-red-50"
        >
          {clearing ? 'Clearing...' : 'Clear'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label className="text-sm font-medium text-gray-600">Chinese Translation</Label>
            <div className="text-lg font-medium">{data.Chinese}</div>
          </div>

          <div>
            <Label className="text-sm font-medium text-gray-600">IPA Pronunciation</Label>
            <div className="text-lg font-mono">{data.Pronunciation}</div>
          </div>

          <div>
            <Label className="text-sm font-medium text-gray-600">Lookup Count</Label>
            <div className="text-lg">{data.LoadCount}</div>
          </div>

          <div>
            <Label className="text-sm font-medium text-gray-600">Status</Label>
            <div className="text-lg">
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  data.AlreadyAcquainted === 1
                    ? 'bg-green-100 text-green-800'
                    : 'bg-gray-100 text-gray-800'
                }`}
              >
                {data.AlreadyAcquainted === 1 ? 'Mastered' : 'Learning'}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
