/**
 * Normalises an ECDICT `phonetic` field for display.
 *
 * The raw field is inconsistent across entries: sometimes bare (`taid`),
 * sometimes bracketed (`[ləun]`), sometimes already slash-wrapped
 * (`/rɪˈtaɪəmənt/`), and sometimes two pronunciations (UK then US)
 * concatenated with no separator (`[dɪˈskrɪmɪnətəri][dɪˈskrɪmɪnətəːri]`).
 *
 * We want exactly one pronunciation, wrapped in a single pair of slashes, or
 * '' when there is nothing usable. Callers should treat '' as "no phonetic"
 * and render nothing.
 *
 * Idempotent: formatPhonetic(formatPhonetic(x)) === formatPhonetic(x).
 */
export const formatPhonetic = (raw?: string | null): string => {
  if (!raw) return ''
  let s = raw.trim()
  if (!s) return ''

  // Two or more bracketed pronunciations concatenated -> keep the last one,
  // which by ECDICT convention is the US pronunciation (this is the entry enx
  // has always shown -- see the former content-script extractUSPhonetic).
  const bracketed = s.match(/\[[^\]]+\]/g)
  if (bracketed && bracketed.length >= 2) {
    s = bracketed[bracketed.length - 1]
  }

  // Strip any existing wrapping delimiters ([...] or /.../) and surrounding
  // whitespace, then re-wrap in a single pair of slashes.
  s = s.replace(/^[/[]+/, '').replace(/[/\]]+$/, '').trim()
  if (!s) return ''

  return `/${s}/`
}
