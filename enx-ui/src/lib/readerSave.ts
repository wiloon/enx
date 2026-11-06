// Reader identity and save ordering are local to the current article. Network
// responses never choose which document the user is editing.
export interface ReaderSaveRequest {
  id: string
  version: number
  content: string
}

interface SaveResponse {
  success: boolean
  data?: { id: string; version: number }
  status?: number
}

export const READER_CONFLICT_MESSAGE =
  'This document was edited elsewhere. Reopen it from My Documents before editing again.'
export const READER_SAVE_FAILED_MESSAGE = "Couldn't save (still readable)"

export class ReaderSaveSession {
  private id: string | null = null
  private version = 0
  private conflicted = false

  constructor(private readonly createId: () => string) {}

  startNew(): void {
    this.id = this.createId()
    this.version = 0
    this.conflicted = false
  }

  open(id: string, version: number): void {
    this.id = id
    this.conflicted = false
    this.version = version
  }

  submit(content: string): ReaderSaveRequest | null {
    if (this.conflicted) return null
    this.id ??= this.createId()
    return { id: this.id, version: ++this.version, content }
  }

  complete(request: ReaderSaveRequest, response: SaveResponse) {
    if (request.id !== this.id || request.version !== this.version) return null
    const saved =
      response.success &&
      response.data?.id === request.id &&
      response.data.version === request.version
    this.conflicted = response.status === 409 || (response.success && !saved)
    return {
      status: saved ? ('saved' as const) : ('error' as const),
      message: this.conflicted
        ? READER_CONFLICT_MESSAGE
        : READER_SAVE_FAILED_MESSAGE,
    }
  }
}
