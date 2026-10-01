'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Mirrors the limits enx-api enforces on an admin edit.
export const CHINESE_MAX = 4000
export const PRONUNCIATION_MAX = 100

// An admin's edit of one words row (ADR-045): the Chinese definition and the
// pronunciation. Saving is also how an AI-made row is approved, so Save works
// on unchanged text. The server has the final say; this only keeps an obviously
// empty definition from being sent.
export default function WordEditor({
  idPrefix,
  initialChinese,
  initialPronunciation,
  saving,
  error,
  onSave,
  onCancel,
}: {
  idPrefix: string
  initialChinese: string
  initialPronunciation: string
  saving: boolean
  error?: string | null
  onSave: (chinese: string, pronunciation: string) => void
  onCancel: () => void
}) {
  const [chinese, setChinese] = useState(initialChinese)
  const [pronunciation, setPronunciation] = useState(initialPronunciation)
  const empty = chinese.trim() === ''

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!empty && !saving) onSave(chinese, pronunciation)
      }}
    >
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-chinese`}>Chinese definition</Label>
        <textarea
          id={`${idPrefix}-chinese`}
          value={chinese}
          onChange={(e) => setChinese(e.target.value)}
          maxLength={CHINESE_MAX}
          rows={4}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-pronunciation`}>Pronunciation</Label>
        <Input
          id={`${idPrefix}-pronunciation`}
          value={pronunciation}
          onChange={(e) => setPronunciation(e.target.value)}
          maxLength={PRONUNCIATION_MAX}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={empty || saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
