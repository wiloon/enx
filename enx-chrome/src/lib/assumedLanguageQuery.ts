// The language a card made now is assumed to get: the background's own
// assumption for getOneWord (ADR-098). The definition corrects it.

import { sendMessageToBackground } from '@/services/api'
import type { BackgroundResponse, ContentMessage } from '@/types'
import {
  storageLanguageForResponse,
  type ExplanationLanguage,
} from './assumedExplanationLanguage'

export const assumedLanguage = async (): Promise<ExplanationLanguage> => {
  try {
    const response = await sendMessageToBackground<
      BackgroundResponse | undefined
    >({ type: 'getExplanationLanguage' } satisfies ContentMessage)
    return storageLanguageForResponse(response?.explanationLanguage)
  } catch {
    return storageLanguageForResponse(undefined)
  }
}
