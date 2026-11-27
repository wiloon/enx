// Reading-view width presets. Each one targets a kind of pasted content:
// plain prose reads best around 70-80 characters per line, while text with
// code, file paths or tables (e.g. an AI assistant's reply) wraps badly at
// that width and needs more room. The choice is a per-browser convenience,
// remembered in localStorage.
export type ReaderWidth = 'narrow' | 'medium' | 'wide' | 'full'

export const READER_WIDTHS: {
  value: ReaderWidth
  label: string
  hint: string
  className: string
}[] = [
  {
    value: 'narrow',
    label: 'Narrow',
    hint: 'Prose: essays, stories, news',
    className: 'max-w-2xl', // 672px
  },
  {
    value: 'medium',
    label: 'Medium',
    hint: 'Articles with some code or lists',
    className: 'max-w-4xl', // 896px
  },
  {
    value: 'wide',
    label: 'Wide',
    hint: 'Code, tables, logs',
    className: 'max-w-6xl', // 1152px
  },
  {
    value: 'full',
    label: 'Full',
    hint: 'Use the whole window',
    className: 'max-w-none',
  },
]

export const DEFAULT_READER_WIDTH: ReaderWidth = 'medium'

export const READER_WIDTH_STORAGE_KEY = 'enx.reader.width'

export function readerWidthClass(width: ReaderWidth): string {
  return READER_WIDTHS.find((w) => w.value === width)!.className
}

// Storage can be unavailable (private mode, blocked site data); fall back to
// the default rather than failing the page.
export function loadReaderWidth(): ReaderWidth {
  try {
    const stored = localStorage.getItem(READER_WIDTH_STORAGE_KEY)
    if (READER_WIDTHS.some((w) => w.value === stored)) {
      return stored as ReaderWidth
    }
  } catch {
    // ignore
  }
  return DEFAULT_READER_WIDTH
}

export function saveReaderWidth(width: ReaderWidth): void {
  try {
    localStorage.setItem(READER_WIDTH_STORAGE_KEY, width)
  } catch {
    // ignore
  }
}
