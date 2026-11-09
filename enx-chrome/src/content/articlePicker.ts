import tailwindCss from '@/index.css?inline'
import { isStableArticleClass } from '@/lib/articleChoice'
// DOM edge for ADR-073. It reads the host page without changing its nodes.
const quoted = (value: string) =>
  '"' +
  value.replace(
    /[\\"\n\r\f]/g,
    char => '\\' + char.codePointAt(0)!.toString(16) + ' '
  ) +
  '"'

export function isPickable(node: Element): boolean {
  return (
    node.isConnected &&
    node !== node.ownerDocument.body &&
    node !== node.ownerDocument.documentElement &&
    !node.closest('[data-enx-ui]')
  )
}

export function articleSelector(node: Element): string | null {
  if (!isPickable(node)) return null
  let chain = ''
  for (
    let ancestor: Element | null = node;
    ancestor && isPickable(ancestor);
    ancestor = ancestor.parentElement
  ) {
    const classes = Array.from(ancestor.classList).filter(isStableArticleClass)
    const parts = [
      ...(ancestor.id ? [`[id=${quoted(ancestor.id)}]`] : []),
      ...(classes.length
        ? [classes.map(name => `[class~=${quoted(name)}]`).join('')]
        : []),
      ancestor.localName,
    ]
    for (const part of parts) {
      const candidate = chain ? `${part} > ${chain}` : part
      try {
        const matches = node.ownerDocument.querySelectorAll(candidate)
        if (matches.length === 1 && matches[0] === node) return candidate
      } catch {
        /* Unusual tag names may not be CSS identifiers. */
      }
    }
    chain = chain ? `${parts[0]} > ${chain}` : parts[0]
  }
  // Body is an anchor, never the selected article. This distinguishes an
  // anonymous outer container from nested containers of the same tag.
  const candidate = `body > ${chain}`
  try {
    const matches = node.ownerDocument.querySelectorAll(candidate)
    if (matches.length === 1 && matches[0] === node) return candidate
  } catch {
    /* No reliable CSS selector: retain only the current node. */
  }
  return null
}

export function startArticlePicker(deps: {
  document: Document
  confirm: (node: Element) => void
  cancel: () => void
}): () => void {
  const doc = deps.document
  const win = doc.defaultView!
  const host = doc.createElement('div')
  host.dataset.enxUi = 'article-picker'
  host.id = 'enx-article-picker'
  host.style.cssText =
    'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none'
  const shadow = host.attachShadow({ mode: 'open' })
  const style = doc.createElement('style')
  style.textContent =
    tailwindCss +
    `
    *{box-sizing:border-box} #outline{position:fixed;border:2px solid var(--color-brand);background:color-mix(in oklch,var(--color-brand) 10%,transparent);border-radius:3px}
    #hint{position:fixed;top:12px;left:50%;transform:translateX(-50%);max-width:calc(100vw - 24px);padding:10px 14px;border:1px solid var(--color-brand);border-radius:8px;background:var(--color-background);color:var(--color-foreground);font:14px/1.5 system-ui;box-shadow:0 2px 12px color-mix(in oklch,var(--color-foreground) 12%,transparent)}`
  const outline = doc.createElement('div')
  outline.id = 'outline'
  outline.hidden = true
  const hint = doc.createElement('div')
  hint.id = 'hint'
  hint.setAttribute('role', 'status')
  hint.textContent =
    'Choose article · Point at the article · Click to confirm · Esc to cancel'
  shadow.append(style, outline, hint)
  doc.documentElement.append(host)
  let selected: Element | null = null
  const paint = () => {
    outline.hidden = !selected
    if (!selected) return
    const box = selected.getBoundingClientRect()
    Object.assign(outline.style, {
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    })
    hint.textContent = `${selected.textContent?.trim().length ?? 0} characters · ↑ Parent · ↓ Back · Click to confirm · Esc to cancel`
  }
  let children: Element[] = []
  const move = (event: Event) => {
    const node = event.target
    selected = node instanceof win.Element && isPickable(node) ? node : null
    children = []
    paint()
  }
  const block = (event: Event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const click = (event: Event) => {
    block(event)
    if (!selected) return
    const node = selected
    stop()
    deps.confirm(node)
  }
  const key = (event: KeyboardEvent) => {
    if (!['Escape', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    block(event)
    if (event.key === 'Escape') {
      stop()
      deps.cancel()
      return
    }
    if (
      event.key === 'ArrowUp' &&
      selected?.parentElement &&
      isPickable(selected.parentElement)
    ) {
      children.push(selected)
      selected = selected.parentElement
    } else if (event.key === 'ArrowDown' && children.length) {
      selected = children.pop()!
    }
    paint()
  }
  const suppress = [
    'pointerdown',
    'pointerup',
    'mousedown',
    'mouseup',
    'dblclick',
    'contextmenu',
  ]
  const stop = () => {
    win.removeEventListener('pointermove', move, true)
    win.removeEventListener('click', click, true)
    win.removeEventListener('keydown', key, true)
    win.removeEventListener('scroll', paint, true)
    win.removeEventListener('resize', paint)
    suppress.forEach(type => win.removeEventListener(type, block, true))
    host.remove()
  }
  win.addEventListener('pointermove', move, true)
  win.addEventListener('click', click, true)
  win.addEventListener('keydown', key, true)
  win.addEventListener('scroll', paint, true)
  win.addEventListener('resize', paint)
  suppress.forEach(type => win.addEventListener(type, block, true))
  return stop
}

export function showArticleChoiceNotice(
  doc: Document,
  message: string,
  error = false
): () => void {
  const host = doc.createElement('div')
  host.id = 'enx-article-choice-notice'
  host.dataset.enxUi = 'article-choice-notice'
  host.style.cssText =
    'all:initial;position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;width:max-content;max-width:calc(100vw - 24px)'
  const shadow = host.attachShadow({ mode: 'open' })
  const style = doc.createElement('style')
  style.textContent = tailwindCss
  const notice = doc.createElement('div')
  notice.className =
    'flex items-center gap-3 rounded-lg border border-brand bg-background px-4 py-3 text-sm text-foreground shadow-lg'
  const text = doc.createElement('p')
  text.setAttribute('role', error ? 'alert' : 'status')
  text.textContent = message
  const close = doc.createElement('button')
  close.type = 'button'
  close.textContent = 'Dismiss'
  close.className =
    'rounded px-2 py-1 text-xs text-brand hover:bg-brand-muted active:scale-95 focus-visible:outline-2 focus-visible:outline-brand'
  close.onclick = () => host.remove()
  notice.append(text, close)
  shadow.append(style, notice)
  doc.documentElement.append(host)
  return () => host.remove()
}
