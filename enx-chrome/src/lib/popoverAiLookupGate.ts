// Bind an AI lookup's deps to a popover lookup gate (ADR-098 / #1236): an
// answer started before 中 / EN switches is dropped after beginSwitch; an
// answer started from that switch's own re-read (onMiss) belongs to it.

import type { AiLookupDeps } from '@/lib/aiLookupFlow'

export type PopoverLookupGateSnapshot = {
  isCurrent: () => boolean
}

// Returns deps whose isCurrent is true only while both the caller's check and
// the gate snapshot still hold. Capture the snapshot when the AI request
// starts (or when the switch's onMiss runs), not later.
export function bindPopoverAiLookupGate(
  deps: AiLookupDeps,
  gate: PopoverLookupGateSnapshot
): AiLookupDeps {
  const baseIsCurrent = deps.isCurrent
  return {
    ...deps,
    isCurrent: () => baseIsCurrent() && gate.isCurrent(),
  }
}
