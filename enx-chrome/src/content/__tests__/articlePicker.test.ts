import { articleSelector } from '../articlePicker'

it('prefers an escaped id and selects exactly the chosen node', () => {
  document.body.innerHTML =
    '<main id="story:body" class="article-body">Hello</main>'
  const node = document.querySelector('main')!
  expect(articleSelector(node)).toBe('[id="story:body"]')
  expect(document.querySelector(articleSelector(node)!)).toBe(node)
})

it('uses a stable class chain when the chosen class alone is ambiguous', () => {
  document.body.innerHTML =
    '<div class="story"><div class="content">Article</div></div><aside class="content">Sidebar</aside>'
  const node = document.querySelector('.story .content')!
  expect(articleSelector(node)).toBe('[class~="story"] > [class~="content"]')
  expect(document.querySelectorAll(articleSelector(node)!)).toHaveLength(1)
})

it('skips build hashes and returns null when stable structure cannot distinguish the node', () => {
  document.body.innerHTML =
    '<div class="css-a8f73c story_ab12cd"><p>One</p></div><div><p>Two</p></div>'
  expect(articleSelector(document.querySelector('div')!)).toBeNull()
})

it('outlines the hovered node and confirms without sending the click to the page', async () => {
  const { startArticlePicker } = await import('../articlePicker')
  document.body.innerHTML = '<main><p>Hello world</p></main>'
  const pageClick = jest.fn()
  document.querySelector('p')!.addEventListener('click', pageClick)
  const confirm = jest.fn()
  const stop = startArticlePicker({ document, confirm, cancel: jest.fn() })
  document
    .querySelector('p')!
    .dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
  document
    .querySelector('p')!
    .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  expect(confirm).toHaveBeenCalledWith(document.querySelector('p'))
  expect(pageClick).not.toHaveBeenCalled()
  stop()
})

it('widens and narrows without scrolling, never widens to body, and Esc removes the picker', async () => {
  const { startArticlePicker } = await import('../articlePicker')
  document.body.innerHTML = '<main><p>Hello world</p></main>'
  const confirm = jest.fn()
  const cancel = jest.fn()
  const stop = startArticlePicker({ document, confirm, cancel })
  document
    .querySelector('p')!
    .dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
  for (const key of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowUp']) {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  }
  document
    .querySelector('p')!
    .dispatchEvent(new MouseEvent('click', { bubbles: true }))
  expect(confirm).toHaveBeenCalledWith(document.querySelector('main'))
  stop()
  startArticlePicker({ document, confirm, cancel })
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  )
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(document.querySelector('#enx-article-picker')).toBeNull()
})

it('keeps ordinary BEM and underscore class names', () => {
  document.body.innerHTML =
    '<div class="article__content post_body">Story</div><div>Sidebar</div>'
  expect(articleSelector(document.querySelector('div')!)).toBe(
    '[class~="article__content"][class~="post_body"]'
  )
})

it('falls back to a page-only choice for a tag that cannot form a CSS selector', () => {
  document.body.innerHTML = ''
  const node = document.createElement('foo:article')
  document.body.append(node)
  expect(articleSelector(node)).toBeNull()
})

it('skips mixed-case CSS module hashes even when they contain no digits', () => {
  document.body.innerHTML =
    '<div class="Article_body__Xyzabc">One</div><div>Two</div>'
  expect(articleSelector(document.querySelector('div')!)).toBeNull()
})

it('anchors an anonymous top-level container to body without making body pickable', () => {
  document.body.innerHTML =
    '<table><tbody><tr><td>Story<table><tbody><tr><td>Nested</td></tr></tbody></table></td></tr></tbody></table>'
  const root = document.querySelector('body > table')!
  expect(articleSelector(root)).toBe('body > table')
  expect(document.querySelectorAll(articleSelector(root)!)).toHaveLength(1)
  expect(articleSelector(document.body)).toBeNull()
})
